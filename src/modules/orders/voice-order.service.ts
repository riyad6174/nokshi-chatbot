import type { CustomerDetails, Order } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { phoneDigits } from "@/lib/digits";
import { priceLabel } from "@/lib/money";
import { getActiveCart } from "@/modules/cart/cart.service";
import type { CheckoutLineSnapshot } from "@/modules/commerce/commerce-adapter";
import { prepareCheckoutForSession } from "@/modules/commerce/checkout.service";
import type { SessionContext } from "@/modules/conversations/session.service";
import { OrderError, parseShippingZones, placeOrderFromCheckout, shippingFor } from "@/modules/orders/order.service";
import type { OrderConfirmationData } from "@/types/chat";

// Ordering inside the conversation (by voice or text), paid cash on delivery:
//   1. proposeOrder: validates the cart, stores the details, and returns the confirmation card.
//   2. confirmProposedOrder: places it, after the customer confirmed the card (tap, or a later turn).
// The confirmation id is the prepared checkout's token; it only works for the session that owns the cart.

function parseLines(value: string): CheckoutLineSnapshot[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as CheckoutLineSnapshot[]) : [];
  } catch {
    return [];
  }
}

function sameCustomer(a: CustomerDetails, b: CustomerDetails): boolean {
  const clean = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    clean(a.name) === clean(b.name) &&
    phoneDigits(a.phone) === phoneDigits(b.phone) &&
    clean(a.address) === clean(b.address) &&
    clean(a.city) === clean(b.city)
  );
}

/** The newest order summary shown to this session that is still waiting for the customer's yes. */
export async function findOpenProposal(session: Pick<SessionContext, "sessionId" | "storeId">) {
  const cart = await getActiveCart(session.sessionId, session.storeId);
  if (!cart) return null;
  const checkout = await prisma.checkoutSession.findFirst({
    where: { cartId: cart.id, status: "prepared", proposedAt: { not: null } },
    orderBy: { proposedAt: "desc" },
  });
  if (!checkout || !checkout.customer || (checkout.expiresAt && checkout.expiresAt < new Date())) return null;
  return checkout;
}

/** One line for the AI's instructions while a summary waits for confirmation. */
export async function describeOpenProposal(session: Pick<SessionContext, "sessionId" | "storeId">): Promise<string | null> {
  const checkout = await findOpenProposal(session);
  if (!checkout?.customer) return null;
  return `Order summary on screen, waiting for the customer's yes: total ${priceLabel(checkout.subtotalMinor, checkout.currency)} + delivery, for ${checkout.customer.name}, ${checkout.customer.phone}, ${checkout.customer.address}.`;
}

export function deliveryAreas(store: SessionContext["store"]) {
  return parseShippingZones(store.shippingZones).map((zone) => ({ id: zone.id, label: zone.label, feeMinor: zone.feeMinor }));
}

export async function proposeOrder(input: {
  session: SessionContext;
  customer: CustomerDetails;
  shippingZoneId: string;
}): Promise<OrderConfirmationData> {
  const store = input.session.store;
  if (!store.codEnabled) {
    throw new OrderError("payment_unavailable", "Cash on delivery isn't available for this store. Use the checkout page instead.");
  }

  const prepared = await prepareCheckoutForSession({ sessionId: input.session.sessionId, store });
  const checkout = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: prepared.checkoutSessionId } });
  const lines = parseLines(checkout.lines);
  const shipping = shippingFor(store, input.shippingZoneId, checkout.subtotalMinor);

  // Showing the same summary again (same cart, same details) must not reset when it was first shown,
  // or a "yes" in the next message would look like it came before the customer saw it.
  const unchanged =
    checkout.proposedAt &&
    checkout.customer &&
    sameCustomer(checkout.customer, input.customer) &&
    (checkout.shippingZoneId ?? "") === (shipping.zone?.id ?? "");
  await prisma.checkoutSession.update({
    where: { id: checkout.id },
    data: {
      customer: input.customer,
      shippingZoneId: shipping.zone?.id ?? "",
      ...(unchanged ? {} : { proposedAt: new Date() }),
    },
  });

  return {
    confirmationId: checkout.token,
    lines: lines.map((line) => ({
      name: line.name,
      variantTitle: line.variantTitle ?? null,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineTotalMinor: line.lineTotalMinor,
    })),
    subtotalMinor: checkout.subtotalMinor,
    shippingMinor: shipping.feeMinor,
    totalMinor: checkout.subtotalMinor + shipping.feeMinor,
    currency: checkout.currency,
    deliveryArea: shipping.zone?.label ?? null,
    customer: {
      name: input.customer.name,
      phone: input.customer.phone,
      email: input.customer.email,
      address: input.customer.address,
      city: input.customer.city,
      notes: input.customer.notes,
    },
    paymentMethod: "cod",
  };
}

/**
 * Places a proposed order. `notBefore` (used when the AI confirms) requires the card to have been
 * shown before the current turn started, so the model can't propose and place in one breath.
 */
export async function confirmProposedOrder(input: {
  session: SessionContext;
  /** Omitted: the newest open summary of this session. */
  confirmationId?: string;
  notBefore?: Date;
}): Promise<Order> {
  const token = input.confirmationId ?? (await findOpenProposal(input.session))?.token;
  if (!token) throw new OrderError("not_proposed", "There is no order summary to confirm. Show it with propose_order first.");
  const checkout = await prisma.checkoutSession.findUnique({
    where: { token },
    include: { cart: { select: { sessionId: true } } },
  });
  if (!checkout || checkout.storeId !== input.session.storeId || checkout.cart.sessionId !== input.session.sessionId) {
    throw new OrderError("not_found", "That order summary was not found. Show the order summary again.");
  }
  if (checkout.status === "completed" && checkout.orderId) {
    const existing = await prisma.order.findUnique({ where: { id: checkout.orderId } });
    if (existing) return existing; // Confirmed twice (tap and voice): same order.
  }
  if (!checkout.proposedAt || !checkout.customer) {
    throw new OrderError("not_proposed", "Show the order summary (propose_order) and get the customer's confirmation first.");
  }
  if (input.notBefore && checkout.proposedAt >= input.notBefore) {
    throw new OrderError(
      "confirmation_required",
      "The customer hasn't confirmed yet. Read back the total and address and ask them to confirm.",
    );
  }

  // The cart must still match the card: re-preparing an unchanged cart returns the same checkout.
  const current = await prepareCheckoutForSession({ sessionId: input.session.sessionId, store: input.session.store });
  if (current.checkoutSessionId !== checkout.id) {
    throw new OrderError("cart_changed", "The cart changed after the summary was shown. Show the updated order summary.");
  }

  return placeOrderFromCheckout({
    token: checkout.token,
    customer: checkout.customer,
    shippingZoneId: checkout.shippingZoneId ?? "",
    paymentMethod: "cod",
  });
}
