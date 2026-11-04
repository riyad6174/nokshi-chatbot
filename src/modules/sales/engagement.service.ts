import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import { recommend, type Recommendation, type RecommendationKind } from "@/modules/catalog/recommendation.service";
import { getProductById, searchProducts } from "@/modules/catalog/product.service";
import { getCartSummary } from "@/modules/cart/cart.service";
import { comparisonRows } from "@/modules/ai/tools/compare-products";
import { appendMessage, toChatMessage } from "@/modules/conversations/conversation.service";
import type { SessionContext } from "@/modules/conversations/session.service";
import { trackEvent } from "@/modules/customers/events.service";
import { describeOpenProposal } from "@/modules/orders/voice-order.service";
import { resolveSalesConfig, type EngagementTrigger, type SalesConfig } from "@/modules/sales/config";
import { getEngagementState, isOptedOut, setSuggestionOptOut, updateEngagementState } from "@/modules/sales/state";
import { recordSuggestions } from "@/modules/sales/tracking";
import type { ChatMessage, ChatPart, ProductCardData } from "@/types/chat";

// Proactive engagement: the assistant may respond to what a shopper does on the site (search, view,
// compare, add to cart, idle cart, checkout), not only to chat messages. Every decision is made here
// on the server from real catalog data, and it is conservative by design:
//   1. what is the shopper doing (the event), 2. is a suggestion relevant (rule/recipe/colour/
//   compatibility matches only, never a generic filler), 3. has it been shown or dismissed already,
//   4. are they checking out, did they opt out, or would it exceed the store's frequency limits.
// No language model is called, so proactive messages are instant, cheap and can't invent anything.

const id = z.string().trim().min(1).max(100);

export const engagementEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("product_view"), productId: id, dwellSeconds: z.number().min(0).max(86_400).default(0) }),
  z.object({ type: z.literal("search"), query: z.string().trim().min(1).max(200), productIds: z.array(id).max(12).optional() }),
  z.object({ type: z.literal("compare"), productIds: z.array(id).min(2).max(4) }),
  z.object({ type: z.literal("add_to_cart"), productId: id }),
  z.object({ type: z.literal("cart_idle") }),
  z.object({ type: z.literal("checkout_start") }),
  z.object({ type: z.literal("dismiss"), suggestionId: z.string().trim().min(8).max(100) }),
  z.object({ type: z.literal("suggestion_click"), suggestionId: z.string().trim().min(8).max(100), productId: id.optional() }),
  z.object({ type: z.literal("opt_out") }),
  z.object({ type: z.literal("opt_in") }),
]);
export type EngagementEvent = z.infer<typeof engagementEventSchema>;

export type EngagementDecision = {
  show: boolean;
  /** Why nothing was shown (for logs and tests), or "shown". */
  reason: string;
  message?: ChatMessage;
  suggestionId?: string;
  /** Short text for a nudge bubble when the chat is closed. */
  nudge?: string | null;
  /** Ask again after this many seconds (dwell/idle time not reached yet). */
  retryAfterSeconds?: number;
};

const skip = (reason: string, retryAfterSeconds?: number): EngagementDecision => ({ show: false, reason, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) });

function names(products: ProductCardData[]): string {
  const list = products.slice(0, 2).map((product) => product.name);
  return list.length === 2 ? `${list[0]} and ${list[1]}` : list[0] ?? "";
}

function fill(template: string, values: { product?: string; suggestions?: string; recipe?: string }): string {
  return template
    .replace(/\{product\}/g, values.product ?? "this")
    .replace(/\{suggestions\}/g, values.suggestions ?? "")
    .replace(/\{recipe\}/g, values.recipe ?? "a meal")
    .replace(/\s+/g, " ")
    .trim();
}

/** Recommendation kinds worth trying for a trigger, from what the store has configured. */
function kindsFor(config: SalesConfig): RecommendationKind[] {
  const has = (kind: string) => config.relationships.some((rule) => rule.kind === kind);
  const kinds: RecommendationKind[] = [];
  if (has("complete_the_look")) kinds.push("complete_the_look");
  if (has("compatible")) kinds.push("compatible");
  if (config.recipes.length > 0) kinds.push("recipe");
  kinds.push("complementary");
  return kinds;
}

const STRONG_SOURCES = new Set(["rule", "color", "compatibility", "recipe"]);

function templateFor(config: SalesConfig, kind: RecommendationKind): string {
  const messages = config.messages;
  const template =
    kind === "complete_the_look"
      ? messages.complete_the_look
      : kind === "compatible"
        ? messages.compatible
        : kind === "recipe"
          ? messages.recipe
          : messages.complementary;
  return template || "{suggestions} go well with {product}. Want to take a look?";
}

async function bestSuggestion(input: {
  context: SessionContext;
  config: SalesConfig;
  anchorProductId: string | null;
  need?: string;
  exclude: string[];
}): Promise<{ kind: RecommendationKind; items: Recommendation[]; recipe: string | null } | null> {
  for (const kind of kindsFor(input.config)) {
    if (!input.anchorProductId && kind !== "recipe") continue;
    const result = await recommend({
      storeId: input.context.storeId,
      kind,
      anchorProductIds: input.anchorProductId ? [input.anchorProductId] : [],
      excludeProductIds: input.exclude,
      config: input.config,
      need: input.need,
      limit: input.config.recommendation.maxPerReply,
    });
    // Only confident matches: a configured relationship, recipe, colour or compatibility. Never filler.
    const items = result.recommendations.filter((entry) => STRONG_SOURCES.has(entry.source) && entry.compatibilityVerified !== false);
    if (items.length > 0) return { kind: kind === "complementary" && result.recipe ? "recipe" : kind, items, recipe: result.recipe ?? null };
  }
  return null;
}

/** Handles one shopper activity event and decides whether the assistant says something. */
export async function handleEngagementEvent(context: SessionContext, event: EngagementEvent, now = new Date()): Promise<EngagementDecision> {
  // Preferences and feedback first: they always apply, whatever the configuration.
  if (event.type === "opt_out" || event.type === "opt_in") {
    const optOut = event.type === "opt_out";
    await setSuggestionOptOut({ storeId: context.storeId, sessionId: context.sessionId, visitorId: context.visitorId, optOut });
    if (optOut) await trackEvent({ storeId: context.storeId, sessionId: context.sessionId, visitorId: context.visitorId, type: "proactive_opt_out", meta: { via: "button" } });
    const text = optOut ? "Got it, no more suggestions from me unless you ask." : "Sure, I'll point out things that go well with what you're looking at.";
    const stored = await appendMessage({ conversationId: context.conversationId, role: "assistant", content: text });
    return { show: true, reason: event.type, message: toChatMessage(stored), nudge: null };
  }
  if (event.type === "dismiss" || event.type === "suggestion_click") {
    let found = false;
    let productIds: string[] = [];
    await updateEngagementState(context.sessionId, (state) => {
      const suggestion = state.suggestions.find((entry) => entry.id === event.suggestionId);
      if (!suggestion) return;
      found = true;
      productIds = suggestion.productIds;
      if (event.type === "dismiss") {
        suggestion.dismissed = true;
        state.dismissedProductIds.push(...suggestion.productIds);
      } else {
        suggestion.clicked = true;
      }
    });
    if (found) {
      await trackEvent({
        storeId: context.storeId,
        sessionId: context.sessionId,
        visitorId: context.visitorId,
        type: event.type === "dismiss" ? "proactive_dismissed" : "recommendation_clicked",
        productId: event.type === "suggestion_click" ? event.productId ?? null : null,
        meta: { suggestionId: event.suggestionId, productIds },
      });
    }
    return skip(found ? event.type : "unknown_suggestion");
  }

  // Record the activity itself (analytics), then decide about a message.
  if (event.type === "search") {
    await trackEvent({ storeId: context.storeId, sessionId: context.sessionId, visitorId: context.visitorId, type: "searched", meta: { query: event.query, source: "site", productIds: event.productIds ?? [] } });
  } else if (event.type === "compare") {
    await trackEvent({ storeId: context.storeId, sessionId: context.sessionId, visitorId: context.visitorId, type: "compared", meta: { productIds: event.productIds, source: "site" } });
  } else if (event.type === "checkout_start") {
    await updateEngagementState(context.sessionId, (state) => {
      state.checkoutStartedAt = now.toISOString();
    });
  }

  const config = resolveSalesConfig(context.store.settings);
  const trigger: EngagementTrigger = event.type;
  if (!config.enabled || !config.engagement.enabled) return skip("disabled");
  const triggerConfig = config.engagement.triggers[trigger];
  if (!triggerConfig.enabled) return skip("trigger_off");

  const conversation = await prisma.conversation.findUnique({ where: { id: context.conversationId }, select: { status: true } });
  if (conversation?.status !== "bot") return skip("human_or_closed");

  const state = await getEngagementState(context.sessionId);
  if (await isOptedOut({ storeId: context.storeId, visitorId: context.visitorId, state })) return skip("opted_out");

  // Checking out: don't distract (except the store's own checkout reassurance, if any).
  const openOrder = await describeOpenProposal(context).catch(() => null);
  if (config.engagement.suppressDuringCheckout && trigger !== "checkout_start" && (state.checkoutStartedAt || openOrder)) {
    return skip("checking_out");
  }
  if (state.proactiveCount >= config.engagement.maxPerSession) return skip("limit_reached");
  if (state.lastProactiveAt) {
    const since = (now.getTime() - Date.parse(state.lastProactiveAt)) / 1000;
    if (since < config.engagement.minSecondsBetween) return skip("too_soon", Math.ceil(config.engagement.minSecondsBetween - since));
  }

  const cart = await getCartSummary(context.sessionId, context.storeId, context.store.currency);
  const exclude = [...new Set([...cart.items.map((item) => item.productId), ...state.dismissedProductIds, ...state.suggestedProductIds])];

  let anchor: ProductCardData | null = null;
  let need: string | undefined;
  let parts: ChatPart[] = [];
  let text = "";
  let label = "Suggested for you";
  let suggestedIds: string[] = [];

  switch (event.type) {
    case "product_view":
    case "add_to_cart": {
      if (event.type === "product_view" && event.dwellSeconds < triggerConfig.delaySeconds) {
        return skip("wait", Math.ceil(triggerConfig.delaySeconds - event.dwellSeconds));
      }
      anchor = await getProductById(context.storeId, event.productId);
      if (!anchor) return skip("unknown_product");
      break;
    }
    case "search": {
      const first = event.productIds?.[0];
      anchor = first ? await getProductById(context.storeId, first) : (await searchProducts({ storeId: context.storeId, text: event.query, limit: 1 }))[0] ?? null;
      need = event.query;
      break;
    }
    case "compare": {
      const products = (await Promise.all(event.productIds.map((productId) => getProductById(context.storeId, productId)))).filter(
        (product): product is ProductCardData => Boolean(product),
      );
      if (products.length < 2) return skip("unknown_product");
      anchor = products[0]!;
      text = `Comparing ${names(products)}? Here's a quick side-by-side to help you choose.`;
      parts = [{ type: "comparison", products, rows: comparisonRows(products) }];
      suggestedIds = [];
      break;
    }
    case "cart_idle": {
      if (cart.items.length === 0) return skip("empty_cart");
      const cartRow = await prisma.cart.findUnique({ where: { id: cart.cartId }, select: { updatedAt: true } });
      const idleSeconds = cartRow ? (now.getTime() - cartRow.updatedAt.getTime()) / 1000 : 0;
      if (idleSeconds < triggerConfig.delaySeconds) return skip("wait", Math.ceil(triggerConfig.delaySeconds - idleSeconds));
      const last = cart.items[cart.items.length - 1]!;
      anchor = await getProductById(context.storeId, last.productId);
      text = fill(config.messages.cart_idle || "Still deciding about {product}? I'm here if you have questions.", { product: last.name });
      break;
    }
    case "checkout_start": {
      if (!config.messages.checkout_start) return skip("no_message");
      text = config.messages.checkout_start;
      break;
    }
  }

  const key = `${trigger}:${anchor?.id ?? "-"}`;
  if (state.shownKeys.includes(key)) return skip("already_shown");

  if (!text) {
    const suggestion = await bestSuggestion({ context, config, anchorProductId: anchor?.id ?? null, need, exclude });
    if (!suggestion) return skip("not_relevant");
    const products = suggestion.items.map((entry) => entry.product);
    suggestedIds = products.map((product) => product.id);
    text = fill(templateFor(config, suggestion.kind), { product: anchor?.name, suggestions: names(products), recipe: suggestion.recipe ?? undefined });
    label = suggestion.kind === "recipe" && suggestion.recipe ? `For your ${suggestion.recipe}` : suggestion.kind === "complete_the_look" ? "Complete the look" : suggestion.kind === "compatible" ? "Compatible accessories" : "Goes well with it";
    parts = [{ type: "product_list", products, label }];
  }

  const { suggestionId } = await recordSuggestions({
    storeId: context.storeId,
    sessionId: context.sessionId,
    visitorId: context.visitorId,
    trigger,
    anchorProductId: anchor?.id ?? null,
    productIds: suggestedIds,
    proactive: true,
  });
  const stored = await appendMessage({
    conversationId: context.conversationId,
    role: "assistant",
    content: text,
    parts: [{ type: "text", text }, ...parts, { type: "suggestion_actions", suggestionId, trigger }],
  });
  logger.info("engagement.shown", { storeId: context.storeId, trigger, products: suggestedIds.length });
  return {
    show: true,
    reason: "shown",
    message: toChatMessage(stored),
    suggestionId,
    nudge: config.engagement.nudgeWhenClosed ? text : null,
  };
}

/** What the widget needs to know to report activity (no secrets, nothing per customer). */
export function engagementClientSettings(config: SalesConfig) {
  const on = config.enabled && config.engagement.enabled;
  return {
    enabled: on,
    triggers: Object.fromEntries(
      Object.entries(config.engagement.triggers).map(([name, trigger]) => [name, on && trigger.enabled ? trigger.delaySeconds : null]),
    ) as Record<EngagementTrigger, number | null>,
    nudgeWhenClosed: config.engagement.nudgeWhenClosed,
  };
}
