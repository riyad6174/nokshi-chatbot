import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import { findProfileForVisitor } from "@/modules/customers/profile.service";

export type CustomerEventType =
  | "viewed_product"
  | "added_to_cart"
  | "removed_from_cart"
  | "checkout_started"
  | "order_placed"
  | "abandoned_cart"
  | "voice_turn";

/**
 * Records shopping activity. Best effort: analytics must never break a customer action, so errors
 * are logged and swallowed. The visitor id is looked up from the session when not given.
 */
export async function trackEvent(input: {
  storeId: string;
  sessionId: string;
  visitorId?: string;
  type: CustomerEventType;
  productId?: string | null;
  cartId?: string | null;
  orderId?: string | null;
  valueMinor?: number | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const visitorId =
      input.visitorId ??
      (await prisma.chatSession.findUnique({ where: { id: input.sessionId }, select: { visitorId: true } }))?.visitorId;
    if (!visitorId) return;
    const profile = await findProfileForVisitor(input.storeId, visitorId);
    await prisma.customerEvent.create({
      data: {
        storeId: input.storeId,
        sessionId: input.sessionId,
        visitorId,
        profileId: profile?.id ?? null,
        type: input.type,
        productId: input.productId ?? null,
        cartId: input.cartId ?? null,
        orderId: input.orderId ?? null,
        valueMinor: input.valueMinor ?? null,
        meta: JSON.stringify(input.meta ?? {}),
      },
    });
  } catch (error) {
    logger.warn("customer.event_failed", { type: input.type, error: error instanceof Error ? error.message : String(error) });
  }
}

const ABANDONED_AFTER_MS = 2 * 60 * 60 * 1000;

/**
 * Flags carts with items that haven't changed for 2 hours and weren't checked out, once per cart,
 * for follow-up. The cart itself stays active so the customer finds it when they come back.
 */
export async function flagAbandonedCarts(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ABANDONED_AFTER_MS);
  const carts = await prisma.cart.findMany({
    where: { status: "active", updatedAt: { lt: cutoff }, items: { some: {} } },
    include: { items: true, session: { select: { visitorId: true } } },
    take: 500,
  });
  let flagged = 0;
  for (const cart of carts) {
    const already = await prisma.customerEvent.findFirst({ where: { cartId: cart.id, type: "abandoned_cart" }, select: { id: true } });
    if (already) continue;
    await trackEvent({
      storeId: cart.storeId,
      sessionId: cart.sessionId,
      visitorId: cart.session.visitorId,
      type: "abandoned_cart",
      cartId: cart.id,
      valueMinor: cart.items.reduce((sum, item) => sum + item.priceSnapshotMinor * item.quantity, 0),
      meta: { items: cart.items.map((item) => ({ productId: item.productId, quantity: item.quantity })) },
    });
    flagged += 1;
  }
  return flagged;
}

/** Dashboard numbers for the last `days` days. */
export async function salesStats(storeId: string, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [voiceSessions, orders, abandoned, optIns] = await Promise.all([
    prisma.customerEvent.findMany({
      where: { storeId, type: "voice_turn", at: { gte: since } },
      select: { sessionId: true },
      distinct: ["sessionId"],
    }),
    prisma.customerEvent.findMany({
      where: { storeId, type: "order_placed", at: { gte: since } },
      select: { sessionId: true, valueMinor: true },
    }),
    prisma.customerEvent.count({ where: { storeId, type: "abandoned_cart", at: { gte: since } } }),
    prisma.customerProfile.count({
      where: { storeId, marketingConsent: { is: { granted: true, at: { gte: since } } } },
    }),
  ]);
  const voiceSessionIds = new Set(voiceSessions.map((event) => event.sessionId));
  const voiceOrders = orders.filter((order) => voiceSessionIds.has(order.sessionId));
  return {
    voiceSessions: voiceSessionIds.size,
    orders: orders.length,
    revenueMinor: orders.reduce((sum, order) => sum + (order.valueMinor ?? 0), 0),
    voiceOrders: voiceOrders.length,
    voiceRevenueMinor: voiceOrders.reduce((sum, order) => sum + (order.valueMinor ?? 0), 0),
    abandoned,
    optIns,
  };
}
