import type { NextRequest } from "next/server";
import { logger } from "@/lib/logging/logger";
import { rateLimit } from "@/lib/rate-limit";
import { jsonError, jsonOk, readJson, validationError } from "@/lib/http";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { checkoutRequestSchema } from "@/lib/validation/schemas";
import { getSessionContext } from "@/modules/conversations/session.service";
import { CheckoutError, prepareCheckoutForSession, saveCheckoutCustomer } from "@/modules/commerce/checkout.service";
import { getCartSummaryByCartId } from "@/modules/cart/cart.service";
import { UntrustedCheckoutUrlError } from "@/modules/commerce/checkout-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session first.");

  const rate = await rateLimit(`checkout:${sessionId}`, 10, 60_000);
  if (!rate.allowed) return jsonError(429, "rate_limited", "Too many checkout attempts. Please wait a moment.");

  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired.");

  const body = await readJson(request);
  const parsed = checkoutRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const prepared = await prepareCheckoutForSession({
      sessionId: context.sessionId,
      store: context.store,
      clientIdempotencyKey: parsed.data.idempotencyKey,
    });
    if (parsed.data.customer) await saveCheckoutCustomer(prepared.checkoutSessionId, parsed.data.customer);

    const cart = context.cartId
      ? await getCartSummaryByCartId(context.cartId, context.storeId)
      : null;

    return jsonOk({
      checkoutSessionId: prepared.checkoutSessionId,
      checkoutUrl: prepared.checkoutUrl,
      cartSummary: cart,
    });
  } catch (error) {
    if (error instanceof CheckoutError) {
      return jsonError(error.code === "cart_empty" ? 400 : 409, error.code, error.message, error.details);
    }
    if (error instanceof UntrustedCheckoutUrlError) {
      logger.error("checkout.untrusted_url", { storeId: context.storeId });
      return jsonError(500, "checkout_failed", "The checkout link could not be verified. Nothing was charged.");
    }
    logger.error("checkout.failed", {
      storeId: context.storeId,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError(500, "checkout_failed", "Checkout could not be prepared. Nothing was charged. Please try again.");
  }
}
