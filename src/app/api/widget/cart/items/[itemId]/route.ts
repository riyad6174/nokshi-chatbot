import type { NextRequest } from "next/server";
import { CartError, getActiveCart, removeItem, updateItem } from "@/modules/cart/cart.service";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { jsonError, jsonOk, readJson, validationError } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { removeCartItemSchema, updateCartItemSchema } from "@/lib/validation/schemas";
import { getSessionContext } from "@/modules/conversations/session.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveContext(request: NextRequest, itemId: string) {
  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return { error: jsonError(401, "session_required", "Start a chat session first.") } as const;

  const rate = await rateLimit(`cart:${sessionId}`, 60, 60_000);
  if (!rate.allowed) {
    return { error: jsonError(429, "rate_limited", "Too many cart changes. Please slow down.") } as const;
  }

  const context = await getSessionContext(sessionId);
  if (!context) return { error: jsonError(401, "session_expired", "Your chat session expired.") } as const;

  const cart = await getActiveCart(context.sessionId, context.storeId);
  if (!cart) return { error: jsonError(400, "cart_not_found", "No active cart was found.") } as const;
  if (!cart.items.some((item) => item.id === itemId)) {
    return { error: jsonError(404, "item_not_found", "That cart item was not found.") } as const;
  }

  return { context, cart } as const;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const resolved = await resolveContext(request, itemId);
  if ("error" in resolved) return resolved.error;

  const body = await readJson(request);
  const parsed = updateCartItemSchema.safeParse({ itemId, quantity: (body as { quantity?: unknown })?.quantity });
  if (!parsed.success) return validationError(parsed.error);

  try {
    const cart = await updateItem({
      sessionId: resolved.context.sessionId,
      storeId: resolved.context.storeId,
      cartId: resolved.cart.id,
      itemId,
      quantity: parsed.data.quantity,
    });
    return jsonOk({ cart });
  } catch (error) {
    if (error instanceof CartError) return jsonError(400, error.code, error.message, error.details);
    throw error;
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const resolved = await resolveContext(request, itemId);
  if ("error" in resolved) return resolved.error;

  const parsed = removeCartItemSchema.safeParse({ itemId });
  if (!parsed.success) return validationError(parsed.error);

  try {
    const cart = await removeItem({
      sessionId: resolved.context.sessionId,
      storeId: resolved.context.storeId,
      cartId: resolved.cart.id,
      itemId,
    });
    return jsonOk({ cart });
  } catch (error) {
    if (error instanceof CartError) return jsonError(400, error.code, error.message, error.details);
    throw error;
  }
}
