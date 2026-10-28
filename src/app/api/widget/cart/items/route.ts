import type { NextRequest } from "next/server";
import { CartError, addItem } from "@/modules/cart/cart.service";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { jsonError, jsonOk, readJson, validationError } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { addCartItemSchema } from "@/lib/validation/schemas";
import { getSessionContext } from "@/modules/conversations/session.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session first.");

  const rate = checkRateLimit(`cart:${sessionId}`, 60, 60_000);
  if (!rate.allowed) return jsonError(429, "rate_limited", "Too many cart changes. Please slow down.");

  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired.");

  const body = await readJson(request);
  const parsed = addCartItemSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const cart = await addItem({
      sessionId: context.sessionId,
      storeId: context.storeId,
      currency: context.store.currency,
      productId: parsed.data.productId,
      variantId: parsed.data.variantId ?? null,
      quantity: parsed.data.quantity,
    });
    return jsonOk({ cart });
  } catch (error) {
    if (error instanceof CartError) {
      return jsonError(400, error.code, error.message, error.details);
    }
    throw error;
  }
}
