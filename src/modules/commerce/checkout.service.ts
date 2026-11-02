import { createHash } from "node:crypto";
import type { Cart, CustomerDetails, Store } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import { getCartForCheckout } from "@/modules/cart/cart.service";
import { trackEvent } from "@/modules/customers/events.service";
import type { CheckoutLine } from "@/modules/commerce/commerce-adapter";
import { assertTrustedCheckoutUrl } from "@/modules/commerce/checkout-url";
import { CheckoutValidationError, createInternalCommerceAdapter } from "@/modules/commerce/internal.adapter";

export class CheckoutError extends Error {
  code: string;
  details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "CheckoutError";
    this.code = code;
    this.details = details;
  }
}

type CartWithProducts = Awaited<ReturnType<typeof getCartForCheckout>>;

export function buildCheckoutLines(cart: NonNullable<CartWithProducts>): CheckoutLine[] {
  return cart.items.map((item) => ({
    productId: item.productId,
    variantId: item.productVariantId,
    quantity: item.quantity,
  }));
}

function buildIdempotencyKey(cart: Cart, lines: CheckoutLine[]): string {
  const signature = lines
    .map((line) => `${line.productId}:${line.variantId ?? "none"}:${line.quantity}`)
    .sort()
    .join("|");
  return createHash("sha256").update(`${cart.id}|${signature}`).digest("hex").slice(0, 40);
}

function adapterFor(store: Store) {
  return createInternalCommerceAdapter(store);
}

export type PreparedCheckoutResult = {
  checkoutSessionId: string;
  checkoutUrl: string;
  expiresAt: Date | null;
};

export async function prepareCheckoutForSession(input: {
  sessionId: string;
  store: Store;
  clientIdempotencyKey?: string;
}): Promise<PreparedCheckoutResult> {
  const cart = await getCartForCheckout(input.sessionId, input.store.id);
  if (!cart || cart.items.length === 0) {
    throw new CheckoutError("cart_empty", "Your cart is empty. Add an item before checking out.");
  }

  const lines = buildCheckoutLines(cart);
  const key = input.clientIdempotencyKey?.slice(0, 120) || buildIdempotencyKey(cart, lines);

  const existing = await prisma.checkoutSession.findUnique({
    where: { cartId_idempotencyKey: { cartId: cart.id, idempotencyKey: key } },
  });

  if (existing) {
    if (existing.status === "prepared" && (!existing.expiresAt || existing.expiresAt > new Date())) {
      assertTrustedCheckoutUrl(existing.checkoutUrl, input.store);
      return { checkoutSessionId: existing.id, checkoutUrl: existing.checkoutUrl, expiresAt: existing.expiresAt };
    }
    if (existing.status === "prepared") {
      await prisma.checkoutSession.update({ where: { id: existing.id }, data: { status: "expired" } });
    }
  }

  const adapter = adapterFor(input.store);
  const validation = await adapter.validateLines(lines);
  if (!validation.valid) {
    throw new CheckoutError(
      "cart_invalid",
      "Some cart items changed and cannot be checked out. Please review your cart.",
      validation.issues,
    );
  }

  const prepared = await adapter.prepareCheckout({
    lines,
    idempotencyKey: key,
    sessionReference: input.sessionId,
  });

  assertTrustedCheckoutUrl(prepared.checkoutUrl, input.store);

  // A new price or availability state invalidates previously prepared handoffs.
  await prisma.checkoutSession.updateMany({
    where: { cartId: cart.id, status: "prepared", idempotencyKey: { not: key } },
    data: { status: "expired" },
  });

  const expiresAt = new Date(Date.now() + 1000 * 60 * 60);
  try {
    const session = await prisma.checkoutSession.create({
      data: {
        storeId: input.store.id,
        cartId: cart.id,
        commerceProvider: process.env.COMMERCE_PROVIDER || "internal",
        token: prepared.token,
        checkoutUrl: prepared.checkoutUrl,
        status: "prepared",
        idempotencyKey: key,
        lines: JSON.stringify(prepared.lines),
        subtotalMinor: prepared.subtotalMinor,
        currency: prepared.currency,
        expiresAt,
      },
    });

    await trackEvent({
      storeId: input.store.id,
      sessionId: input.sessionId,
      type: "checkout_started",
      cartId: cart.id,
      valueMinor: prepared.subtotalMinor,
    });
    logger.info("checkout.prepared", {
      storeId: input.store.id,
      checkoutSessionId: session.id,
      cartId: cart.id,
      lineCount: lines.length,
      subtotalMinor: prepared.subtotalMinor,
    });

    return { checkoutSessionId: session.id, checkoutUrl: session.checkoutUrl, expiresAt: session.expiresAt };
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "P2002") {
      const raced = await prisma.checkoutSession.findUnique({
        where: { cartId_idempotencyKey: { cartId: cart.id, idempotencyKey: key } },
      });
      if (raced) {
        assertTrustedCheckoutUrl(raced.checkoutUrl, input.store);
        return { checkoutSessionId: raced.id, checkoutUrl: raced.checkoutUrl, expiresAt: raced.expiresAt };
      }
    }
    throw error;
  }
}

/** Stores the delivery details collected in chat on the prepared checkout, so the checkout page is pre-filled. */
export async function saveCheckoutCustomer(checkoutSessionId: string, customer: CustomerDetails) {
  await prisma.checkoutSession.update({ where: { id: checkoutSessionId }, data: { customer } });
}

export async function getCheckoutByToken(token: string) {
  const session = await prisma.checkoutSession.findUnique({
    where: { token },
    include: {
      store: true,
      cart: { include: { session: { select: { locale: true } } } },
    },
  });
  if (!session) return null;
  return session;
}

export async function getCheckoutByTokenForStore(token: string, storeId: string) {
  const session = await getCheckoutByToken(token);
  if (!session || session.storeId !== storeId) return null;
  return session;
}

export async function expireCheckout(checkoutSessionId: string) {
  await prisma.checkoutSession.update({ where: { id: checkoutSessionId }, data: { status: "expired" } });
}

export { CheckoutValidationError };
