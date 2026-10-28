import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { getClientIp, checkRateLimit } from "@/lib/rate-limit";
import { jsonError, jsonOk, readJson, validationError } from "@/lib/http";
import { createWidgetToken, readWidgetSessionId, widgetCookieOptions, WIDGET_COOKIE } from "@/lib/auth/widget";
import { widgetSessionRequestSchema } from "@/lib/validation/schemas";
import { getCartSummary } from "@/modules/cart/cart.service";
import { conversationMode, listConversationMessages } from "@/modules/conversations/conversation.service";
import { ensureProductGreeting } from "@/modules/conversations/greeting.service";
import {
  createSession,
  getSessionContext,
  resolveLocaleForStore,
  touchSession,
} from "@/modules/conversations/session.service";
import { parseJsonArray, parseJsonObject } from "@/modules/stores/store.service";
import { isLiveAiEnabled } from "@/modules/ai/run";
import { prisma } from "@/lib/db/prisma";
import type { SuggestedTopic, WidgetSessionResponse } from "@/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TOPICS: SuggestedTopic[] = [
  { label: "Looking for a product", prompt: "I'm looking for a product" },
  { label: "Delivery time", prompt: "How long does delivery take?" },
  { label: "Price list", prompt: "Can you show me your products and prices?" },
  { label: "Order status", prompt: "I want to check my order status" },
  { label: "Refund policy", prompt: "What is your refund and return policy?" },
];

function parseTheme(value: string | null | undefined): { accent?: string; position?: "left" | "right" } {
  const theme = parseJsonObject(value);
  const accent = typeof theme.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(theme.accent) ? theme.accent : "#0f766e";
  const position = theme.position === "left" ? "left" : "right";
  return { accent, position };
}

function parseTopics(value: string | null | undefined): SuggestedTopic[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_TOPICS;
    const topics = parsed
      .filter((entry): entry is SuggestedTopic => typeof entry?.label === "string" && typeof entry?.prompt === "string")
      .slice(0, 8);
    return topics.length > 0 ? topics : DEFAULT_TOPICS;
  } catch {
    return DEFAULT_TOPICS;
  }
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(`session:${getClientIp(request)}`, 60, 60_000);
  if (!rate.allowed) {
    return jsonError(429, "rate_limited", "Too many session requests. Please try again shortly.");
  }

  const body = await readJson(request);
  const parsed = widgetSessionRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  let context = null;
  const existingSessionId = readWidgetSessionId(request);
  if (existingSessionId) {
    const existing = await getSessionContext(existingSessionId);
    if (existing && existing.store.widgetKey === parsed.data.widgetKey) {
      const locale = parsed.data.locale ? resolveLocaleForStore(existing.store, parsed.data.locale) : existing.locale;
      await touchSession(existing.sessionId, locale !== existing.locale ? locale : undefined);
      context = { ...existing, locale };
    }
  }

  if (!context) {
    context = await createSession({
      widgetKey: parsed.data.widgetKey,
      visitorId: parsed.data.visitorId,
      locale: parsed.data.locale,
    });
    if (!context) {
      return jsonError(404, "widget_not_found", "This chat widget is not configured.");
    }
  }

  await ensureProductGreeting(context, parsed.data.productId);

  const [cart, messages, conversation] = await Promise.all([
    getCartSummary(context.sessionId, context.storeId, context.store.currency),
    listConversationMessages(context.conversationId, { limit: 80 }),
    prisma.conversation.findUnique({ where: { id: context.conversationId }, select: { status: true } }),
  ]);
  const settings = context.store.settings;

  const payload: WidgetSessionResponse = {
    sessionId: context.sessionId,
    conversationId: context.conversationId,
    visitorId: context.visitorId,
    locale: context.locale,
    store: {
      name: context.store.name,
      currency: context.store.currency,
      supportedLocales: parseJsonArray(context.store.supportedLocales),
    },
    settings: {
      assistantName: settings?.assistantName || "Shopping assistant",
      welcomeMessage:
        settings?.welcomeMessage || "Hi! Ask me about products, delivery, or returns. I can help you build a cart.",
      fallbackMessage:
        settings?.fallbackMessage || "I could not find an approved answer for that. Please contact the store support team.",
      suggestedTopics: parseTopics(settings?.suggestedTopics),
      voiceEnabled: settings?.voiceEnabled ?? true,
      attachmentsEnabled: settings?.attachmentsEnabled ?? true,
      theme: parseTheme(settings?.widgetTheme),
      aiMode: isLiveAiEnabled(context.store) ? "live" : "demo",
    },
    messages,
    cart,
    conversationMode: conversationMode(conversation?.status ?? "bot"),
  };

  const response: NextResponse = jsonOk(payload);
  response.cookies.set(WIDGET_COOKIE, createWidgetToken(context.sessionId), widgetCookieOptions);
  return response;
}
