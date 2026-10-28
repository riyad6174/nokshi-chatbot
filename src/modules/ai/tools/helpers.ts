import { CartError, getActiveCart, getCartSummary } from "@/modules/cart/cart.service";
import type { CartPayload, ChatPart, ProductCardData } from "@/types/chat";
import type { ToolContext, ToolExecutionResult } from "@/modules/ai/tools/types";

export function cartCompact(cart: CartPayload) {
  return {
    cartId: cart.cartId,
    currency: cart.currency,
    itemCount: cart.itemCount,
    subtotalMinor: cart.subtotalMinor,
    items: cart.items.map((item) => ({
      itemId: item.itemId,
      productId: item.productId,
      variantId: item.variantId,
      name: item.name,
      variantTitle: item.variantTitle,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      lineTotalMinor: item.lineTotalMinor,
      available: item.available,
    })),
  };
}

export function productCompact(product: ProductCardData) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    brand: product.brand || undefined,
    attributes: product.attributes,
    description: product.description.slice(0, 400),
    priceMinor: product.priceMinor,
    currency: product.currency,
    available: product.available,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      sku: variant.sku,
      options: variant.options,
      priceMinor: variant.priceMinor,
      available: variant.available,
    })),
  };
}

export function success(content: unknown, ui?: ChatPart[]): ToolExecutionResult {
  return { ok: true, content: { ok: true, ...(typeof content === "object" && content ? content : { value: content }) }, ui };
}

export function failure(code: string, message: string, details?: unknown): ToolExecutionResult {
  return { ok: false, content: { ok: false, error: { code, message, ...(details ? { details } : {}) } } };
}

export async function getCartForTool(ctx: ToolContext): Promise<CartPayload> {
  return getCartSummary(ctx.session.sessionId, ctx.session.storeId, ctx.session.store.currency);
}

export async function requireActiveCart(ctx: ToolContext) {
  const cart = await getActiveCart(ctx.session.sessionId, ctx.session.storeId);
  if (!cart) throw new CartError("cart_not_found", "No active cart was found for this session.");
  return cart;
}

export function cartErrorToResult(error: unknown): ToolExecutionResult {
  if (error instanceof CartError) {
    return failure(error.code, error.message, error.details);
  }
  throw error;
}
