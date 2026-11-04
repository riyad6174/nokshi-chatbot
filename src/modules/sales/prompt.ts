import { priceLabel } from "@/lib/money";
import { INDUSTRY_LABELS, type SalesConfig } from "@/modules/sales/config";
import { STAGE_GUIDANCE, type ShoppingIntent } from "@/modules/sales/intent";
import type { EngagementState } from "@/modules/sales/state";
import type { CartPayload } from "@/types/chat";

// Prompt sections for the sales engine. `buildSalesPlaybook` depends only on the store's saved
// configuration, so it stays in the cached (stable) part of the system prompt; `buildSalesTurnContext`
// changes every turn and goes in the per-turn part.

const KIND_HELP = `get_recommendations kinds: 'complete_the_look' (outfit/room pieces that go with an item), 'compatible' (accessories that fit a device), 'recipe' (other ingredients for a dish; pass need = the dish), 'bundle' (a complete set for a need), 'complementary' (add-ons), 'similar' (alternatives/substitutes), 'cheaper' (budget alternatives), 'personalized' (based on their interests).`;

export function buildSalesPlaybook(config: SalesConfig, currency: string): string {
  if (!config.enabled) return "";
  const lines: string[] = [];
  lines.push(`SALES & ENGAGEMENT (${INDUSTRY_LABELS[config.industry]}${config.businessType ? `: ${config.businessType}` : ""})`);
  if (config.persona.role) lines.push(`- Your role in this store: ${config.persona.role}.`);
  if (config.persona.personality) lines.push(`- Personality: ${config.persona.personality}`);
  lines.push(
    `- Think like a good salesperson: understand what they're trying to do, ask one useful question when it changes the answer (never one you already asked or they already answered), recommend, explain why, help them decide, then guide them to the order.`,
    `- Recommend at most ${config.recommendation.maxPerReply} products at a time. ${KIND_HELP}`,
    config.recommendation.explainReasons
      ? "- Each suggestion comes with a `reason` from the catalog: say it in your own short words (e.g. \"beige goes well with white\"). Never add reasons, specs, discounts or compatibility the tool didn't give."
      : "- Keep suggestions short; don't explain unless asked.",
    config.salesGoals.upsell
      ? `- Add-ons: you may suggest up to ${config.recommendation.maxAddOnsPerConversation} on your own per conversation, one at a time, when it truly helps. Stop if declined. Pass customerAsked: true only when the customer asked for suggestions in their latest message.`
      : "- Don't suggest add-ons unless the customer asks for suggestions.",
  );
  for (const rule of config.conversationRules) lines.push(`- ${rule}`);
  if (config.salesGoals.checkoutGuidance === "direct") {
    lines.push("- Once they like something, invite the order directly (\"Shall I add it and place the order?\").");
  } else if (config.salesGoals.checkoutGuidance === "gentle") {
    lines.push("- Once they like something, offer the next step gently (\"Want me to add it to your cart?\"). Never pressure.");
  }
  if (config.salesGoals.freeShippingNudge) lines.push("- If the cart is close to free delivery, mention it once.");
  if (config.salesGoals.notes) lines.push(`- Store goals: ${config.salesGoals.notes}`);
  if (config.handoff.highValueCartMinor != null) {
    lines.push(`- For carts of ${priceLabel(config.handoff.highValueCartMinor, currency)} or more, offer once to connect them with a person (request_human if they agree).`);
  }
  if (config.handoff.offerWhenUndecided) {
    lines.push("- If they're still unsure after two suggestions, offer to connect them with a person.");
  }
  lines.push("- If the customer asks you to stop suggesting things, stop: answer only what they ask until they ask for suggestions again.");
  return lines.join("\n");
}

export function buildSalesTurnContext(input: {
  config: SalesConfig;
  intent: ShoppingIntent;
  state: EngagementState;
  optedOut: boolean;
  cart: CartPayload;
  /** Names of products suggested earlier this visit. */
  suggestedNames: string[];
  /** A customer who has shopped or chatted before. */
  returning?: { orders: number; interests: string[] } | null;
}): string {
  if (!input.config.enabled) return "";
  const { config, intent, state } = input;
  const lines = [`SHOPPING SIGNAL (heuristic): ${intent.stage}${intent.signals.length ? ` (${intent.signals.join(", ")})` : ""}. ${STAGE_GUIDANCE[intent.stage]}`];
  if (input.returning && (input.returning.orders > 0 || input.returning.interests.length > 0)) {
    lines.push(
      `RETURNING CUSTOMER: ${input.returning.orders > 0 ? `${input.returning.orders} earlier order(s)` : "visited before"}${
        input.returning.interests.length ? `; interested in ${input.returning.interests.slice(-5).join(", ")}` : ""
      }. Welcome them back naturally and use this to personalise (get_recommendations kind 'personalized'), without listing what you know.`,
    );
  }
  if (input.optedOut && !intent.wantsSuggestions) {
    lines.push("SUGGESTIONS: the customer asked for no more suggestions. Don't recommend add-ons or extras unless they ask in this message.");
  } else if (state.addOnCount >= config.recommendation.maxAddOnsPerConversation && !intent.wantsSuggestions) {
    lines.push(`SUGGESTIONS: add-on limit for this visit reached (${state.addOnCount}). Only suggest more if they ask.`);
  }
  if (input.suggestedNames.length > 0) {
    lines.push(`ALREADY SUGGESTED THIS VISIT (don't repeat unless asked): ${input.suggestedNames.slice(-8).join(", ")}`);
  }
  if (config.handoff.highValueCartMinor != null && input.cart.subtotalMinor >= config.handoff.highValueCartMinor) {
    lines.push("HIGH-VALUE CART: offer once to connect them with a person for help, if you haven't.");
  }
  return lines.join("\n");
}
