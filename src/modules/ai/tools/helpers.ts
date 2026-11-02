import { priceLabel } from "@/lib/money";
import { CartError, getActiveCart, getCartSummary } from "@/modules/cart/cart.service";
import type { CartPayload, ChatPart, ProductCardData } from "@/types/chat";
import type { ToolContext, ToolExecutionResult } from "@/modules/ai/tools/types";

// Prices reach the model as ready-to-say labels ("2,550 taka"), never raw minor units.
export function cartCompact(cart: CartPayload) {
  return {
    cartId: cart.cartId,
    itemCount: cart.itemCount,
    subtotal: priceLabel(cart.subtotalMinor, cart.currency),
    items: cart.items.map((item) => ({
      itemId: item.itemId,
      productId: item.productId,
      variantId: item.variantId,
      name: item.name,
      variantTitle: item.variantTitle,
      quantity: item.quantity,
      unitPrice: priceLabel(item.unitPriceMinor, cart.currency),
      lineTotal: priceLabel(item.lineTotalMinor, cart.currency),
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
    price: priceLabel(product.priceMinor, product.currency),
    available: product.available,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      sku: variant.sku,
      options: variant.options,
      price: priceLabel(variant.priceMinor, product.currency),
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
