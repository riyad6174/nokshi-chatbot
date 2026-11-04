import { prisma } from "@/lib/db/prisma";

// Store analytics for a reporting period, computed from CustomerEvent, AiTurnLog, conversations,
// orders and marketing messages. Everything is scoped to one store.

export const PERIODS = [7, 30, 90] as const;
export type PeriodDays = (typeof PERIODS)[number];

type EventRow = { type: string; sessionId: string; productId: string | null; cartId: string | null; meta: string; at: Date; valueMinor: number | null };
type TurnRow = { outcome: string; latencyMs: number; firstTokenMs: number | null; toolCalls: Array<{ name: string; ok: boolean; code: string }>; userText: string; at: Date; channel: string };

const rate = (part: number, whole: number) => (whole === 0 ? null : part / whole);

function meta(row: EventRow): Record<string, unknown> {
  try {
    const parsed = JSON.parse(row.meta) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

function topCounts(values: string[], limit = 10): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

/** Pure computation over loaded rows (unit-tested). */
export function computeAnalytics(input: { events: EventRow[]; turns: TurnRow[] }) {
  const { events, turns } = input;
  const sessionsWith = (type: string, filter?: (row: EventRow) => boolean) =>
    new Set(events.filter((row) => row.type === type && (!filter || filter(row))).map((row) => row.sessionId));
  const ordered = sessionsWith("order_placed");
  const orderedProducts = new Map<string, Set<string>>();
  for (const row of events.filter((entry) => entry.type === "order_placed")) {
    const ids = Array.isArray(meta(row).productIds) ? (meta(row).productIds as string[]) : [];
    const set = orderedProducts.get(row.sessionId) ?? new Set<string>();
    ids.forEach((id) => set.add(id));
    orderedProducts.set(row.sessionId, set);
  }

  // Search → purchase.
  const productSearches = events.filter((row) => row.type === "searched" && meta(row).scope !== "knowledge");
  const searchSessions = new Set(productSearches.map((row) => row.sessionId));
  const searchToPurchase = [...searchSessions].filter((id) => ordered.has(id)).length;

  // Recommendations: shown → clicked → added → purchased.
  const shownRows = events.filter((row) => row.type === "recommendation_shown" || row.type === "proactive_shown");
  const suggestedBySession = new Map<string, Set<string>>();
  for (const row of shownRows) {
    const ids = Array.isArray(meta(row).productIds) ? (meta(row).productIds as string[]) : [];
    const set = suggestedBySession.get(row.sessionId) ?? new Set<string>();
    ids.forEach((id) => set.add(id));
    suggestedBySession.set(row.sessionId, set);
  }
  const recommendedAdds = events.filter((row) => row.type === "added_to_cart" && meta(row).fromRecommendation === true).length;
  let recommendedPurchases = 0;
  for (const [sessionId, suggested] of suggestedBySession) {
    for (const id of orderedProducts.get(sessionId) ?? []) if (suggested.has(id)) recommendedPurchases += 1;
  }
  const clicks = events.filter((row) => row.type === "recommendation_clicked").length;

  // Cart funnel.
  const cartSessions = sessionsWith("added_to_cart");
  const checkoutSessions = sessionsWith("checkout_started");
  const cartToOrder = [...cartSessions].filter((id) => ordered.has(id)).length;

  // Abandoned carts and recovery.
  const abandoned = events.filter((row) => row.type === "abandoned_cart" && row.cartId);
  const orderedCarts = new Set(events.filter((row) => row.type === "order_placed" && row.cartId).map((row) => row.cartId!));
  const remindedCarts = new Set(events.filter((row) => row.type === "marketing_sent" && row.cartId).map((row) => row.cartId!));
  const recovered = abandoned.filter((row) => orderedCarts.has(row.cartId!)).length;
  const recoveredAfterReminder = abandoned.filter((row) => orderedCarts.has(row.cartId!) && remindedCarts.has(row.cartId!)).length;

  // AI quality.
  const outcomes = { answered: 0, missed: 0, error: 0, handoff: 0 };
  for (const turn of turns) if (turn.outcome in outcomes) outcomes[turn.outcome as keyof typeof outcomes] += 1;
  const toolCalls = turns.flatMap((turn) => turn.toolCalls);
  const toolErrors = toolCalls.filter((call) => !call.ok);

  // Content gaps.
  const missingProducts = topCounts(productSearches.filter((row) => meta(row).matched === false).map((row) => String(meta(row).query ?? "").toLowerCase()).filter(Boolean));
  const missingKnowledge = topCounts(
    events.filter((row) => row.type === "searched" && meta(row).scope === "knowledge" && meta(row).matched === false).map((row) => String(meta(row).query ?? "").toLowerCase()).filter(Boolean),
  );
  const topSearches = topCounts(productSearches.map((row) => String(meta(row).query ?? "").toLowerCase()).filter(Boolean));
  const unanswered = turns
    .filter((turn) => (turn.outcome === "missed" || turn.outcome === "error") && turn.userText.trim())
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 10)
    .map((turn) => ({ text: turn.userText, outcome: turn.outcome, at: turn.at.toISOString() }));

  const orders = events.filter((row) => row.type === "order_placed");
  return {
    sales: {
      orders: orders.length,
      revenueMinor: orders.reduce((sum, row) => sum + (row.valueMinor ?? 0), 0),
      averageOrderMinor: orders.length ? Math.round(orders.reduce((sum, row) => sum + (row.valueMinor ?? 0), 0) / orders.length) : null,
    },
    search: { sessions: searchSessions.size, purchased: searchToPurchase, conversion: rate(searchToPurchase, searchSessions.size), topSearches },
    recommendations: {
      shown: shownRows.length,
      clicked: clicks,
      addedToCart: recommendedAdds,
      purchased: recommendedPurchases,
      addRate: rate(recommendedAdds, shownRows.length),
      purchaseRate: rate(recommendedPurchases, shownRows.length),
    },
    funnel: {
      cartSessions: cartSessions.size,
      checkoutSessions: checkoutSessions.size,
      orderSessions: ordered.size,
      cartToCheckout: rate(checkoutSessions.size, cartSessions.size),
      cartToOrder: rate(cartToOrder, cartSessions.size),
    },
    abandoned: { carts: abandoned.length, recovered, recoveredAfterReminder, recoveryRate: rate(recovered, abandoned.length) },
    engagement: {
      proactiveShown: events.filter((row) => row.type === "proactive_shown").length,
      dismissed: events.filter((row) => row.type === "proactive_dismissed").length,
      optOuts: events.filter((row) => row.type === "proactive_opt_out").length,
      comparisons: events.filter((row) => row.type === "compared").length,
    },
    ai: {
      turns: turns.length,
      ...outcomes,
      successRate: rate(outcomes.answered ?? 0, turns.length),
      handoffRate: rate(outcomes.handoff ?? 0, turns.length),
      toolCalls: toolCalls.length,
      toolErrors: toolErrors.length,
      toolErrorRate: rate(toolErrors.length, toolCalls.length),
      topToolErrors: topCounts(toolErrors.map((call) => `${call.name}: ${call.code || "error"}`), 5),
      latencyP50Ms: percentile(turns.map((turn) => turn.latencyMs), 50),
      latencyP95Ms: percentile(turns.map((turn) => turn.latencyMs), 95),
      firstTokenP50Ms: percentile(turns.map((turn) => turn.firstTokenMs).filter((value): value is number => value != null), 50),
      voiceTurns: turns.filter((turn) => turn.channel === "voice").length,
    },
    gaps: { missingProducts, missingKnowledge, unanswered },
  };
}

export type StoreAnalytics = ReturnType<typeof computeAnalytics> & {
  periodDays: number;
  since: string;
  conversations: number;
  agents: { handoffs: number; answered: number; medianFirstResponseMinutes: number | null; resolved: number; byAgent: Array<{ name: string; replies: number }> };
};

export async function storeAnalytics(storeId: string, periodDays: number, now = new Date()): Promise<StoreAnalytics> {
  const since = new Date(now.getTime() - periodDays * 86_400_000);
  const [events, turns, conversations, handedOff] = await Promise.all([
    prisma.customerEvent.findMany({
      where: { storeId, at: { gte: since } },
      select: { type: true, sessionId: true, productId: true, cartId: true, meta: true, at: true, valueMinor: true },
      take: 100_000,
    }),
    prisma.aiTurnLog.findMany({
      where: { storeId, at: { gte: since } },
      select: { outcome: true, latencyMs: true, firstTokenMs: true, toolCalls: true, userText: true, at: true, channel: true },
      take: 100_000,
    }),
    prisma.conversation.count({ where: { storeId, createdAt: { gte: since } } }),
    prisma.conversation.findMany({
      where: { storeId, handoffAt: { gte: since } },
      select: { id: true, handoffAt: true, status: true },
      take: 5000,
    }),
  ]);

  // Agent performance: time from handoff to the first staff reply, and resolution.
  const responseMinutes: number[] = [];
  const byAgent = new Map<string, number>();
  for (const conversation of handedOff) {
    const replies = await prisma.message.findMany({
      where: { conversationId: conversation.id, role: "agent", createdAt: { gte: conversation.handoffAt! } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, senderName: true },
      take: 200,
    });
    if (replies[0]) responseMinutes.push((replies[0].createdAt.getTime() - conversation.handoffAt!.getTime()) / 60_000);
    for (const reply of replies) byAgent.set(reply.senderName || "Agent", (byAgent.get(reply.senderName || "Agent") ?? 0) + 1);
  }

  return {
    ...computeAnalytics({ events, turns }),
    periodDays,
    since: since.toISOString(),
    conversations,
    agents: {
      handoffs: handedOff.length,
      answered: responseMinutes.length,
      medianFirstResponseMinutes: percentile(responseMinutes, 50),
      resolved: handedOff.filter((conversation) => conversation.status === "closed" || conversation.status === "bot").length,
      byAgent: [...byAgent.entries()].map(([name, replies]) => ({ name, replies })).sort((a, b) => b.replies - a.replies).slice(0, 10),
    },
  };
}
