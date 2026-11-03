import { prisma } from "@/lib/db/prisma";
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

// Lookup errors mean a wrong id, not a sold-out product: say so, so the assistant retries instead
// of telling the customer it's out of stock.
const LOOKUP_ERRORS = new Set(["product_not_found", "variant_not_found"]);

export function cartErrorToResult(error: unknown): ToolExecutionResult {
  if (error instanceof CartError) {
    const message = LOOKUP_ERRORS.has(error.code)
      ? `${error.message} This is a wrong id, NOT a stock problem: never tell the customer it's out of stock. Retry with the product name and version name as shown (product, variant).`
      : error.message;
    return failure(error.code, message, error.details);
  }
  throw error;
}

/** An active product's id from its name, matched loosely; null unless exactly one matches. */
export async function productIdByName(storeId: string, name: string): Promise<string | null> {
  const products = await prisma.product.findMany({ where: { storeId, status: "active" }, select: { id: true, name: true } });
  const wanted = name.trim().toLowerCase();
  const exact = products.find((product) => product.name.toLowerCase() === wanted);
  if (exact) return exact.id;
  const partial = products.filter((product) => product.name.toLowerCase().includes(wanted) || wanted.includes(product.name.toLowerCase()));
  return partial.length === 1 ? partial[0]!.id : null;
}
