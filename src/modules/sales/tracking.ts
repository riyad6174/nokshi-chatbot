import { randomUUID } from "node:crypto";
import { trackEvent } from "@/modules/customers/events.service";
import { updateEngagementState, type EngagementState } from "@/modules/sales/state";

/**
 * Remembers suggestions shown this visit (so they aren't repeated and can be attributed to later cart
 * additions and orders) and records a recommendation_shown event for analytics.
 */
export async function recordSuggestions(input: {
  storeId: string;
  sessionId: string;
  visitorId: string;
  trigger: string;
  anchorProductId: string | null;
  productIds: string[];
  /** The AI suggested an add-on on its own (counts toward the store's limit). */
  addOn?: boolean;
  proactive?: boolean;
  source?: string;
}): Promise<{ suggestionId: string; state: EngagementState }> {
  const suggestionId = randomUUID();
  const now = new Date().toISOString();
  const state = await updateEngagementState(input.sessionId, (current) => {
    current.suggestedProductIds.push(...input.productIds);
    if (input.addOn) current.addOnCount += 1;
    if (input.proactive) {
      current.proactiveCount += 1;
      current.lastProactiveAt = now;
      current.shownKeys.push(`${input.trigger}:${input.anchorProductId ?? "-"}`);
    }
    current.suggestions.push({ id: suggestionId, trigger: input.trigger, anchorProductId: input.anchorProductId, productIds: input.productIds, at: now });
  });
  await trackEvent({
    storeId: input.storeId,
    sessionId: input.sessionId,
    visitorId: input.visitorId,
    type: input.proactive ? "proactive_shown" : "recommendation_shown",
    productId: input.anchorProductId,
    meta: { trigger: input.trigger, productIds: input.productIds, suggestionId, source: input.source ?? "" },
  });
  return { suggestionId, state };
}
