import { prisma } from "@/lib/db/prisma";
import { priceLabel } from "@/lib/money";
import { CartError, getActiveCart, getCartSummary } from "@/modules/cart/cart.service";
import { loadActiveCatalog } from "@/modules/catalog/product.service";
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

/**
 * A product as the model sees it. `brief` (several products in a list): a shorter description and no
 * SKUs, since the cards on screen carry the details and every token here slows the next round.
 */
export function productCompact(product: ProductCardData, options: { brief?: boolean } = {}) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    brand: product.brand || undefined,
    attributes: product.attributes,
    description: product.description.slice(0, options.brief ? 160 : 400),
    price: priceLabel(product.priceMinor, product.currency),
    available: product.available,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      sku: options.brief ? undefined : variant.sku,
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

/** Keeps a tool result from flooding the next model round with long text or giant lists. */
export function compactToolContent(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > 600 ? `${value.slice(0, 599)}…` : value;
  if (value === null || typeof value !== "object") return value;
  if (depth >= 6) return "…";
  if (Array.isArray(value)) {
    const items = value.slice(0, 40).map((item) => compactToolContent(item, depth + 1));
    return value.length > 40 ? [...items, `… ${value.length - 40} more`] : items;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 60)
      .map(([key, entry]) => [key, compactToolContent(entry, depth + 1)]),
  );
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
  const products = await loadActiveCatalog(storeId);
  const wanted = name.trim().toLowerCase();
  const exact = products.find((product) => product.name.toLowerCase() === wanted);
  if (exact) return exact.id;
  const partial = products.filter((product) => product.name.toLowerCase().includes(wanted) || wanted.includes(product.name.toLowerCase()));
  return partial.length === 1 ? partial[0]!.id : null;
}

/**
 * The product at a 1-based position of the latest product list shown in this conversation ("add the
 * second one"), so a number the customer said doesn't depend on the model copying the right id.
 */
export async function productIdAtPosition(conversationId: string, position: number): Promise<string | null> {
  const rows = await prisma.message.findMany({
    where: { conversationId, role: { in: ["assistant", "event"] } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { structuredContent: true },
  });
  for (const row of rows) {
    if (!row.structuredContent) continue;
    let parts: unknown;
    try {
      parts = JSON.parse(row.structuredContent);
    } catch {
      continue;
    }
    const lists = Array.isArray(parts) ? (parts as ChatPart[]).filter((part) => part.type === "product_list") : [];
    const latest = lists.at(-1);
    if (latest && latest.type === "product_list") return latest.products[position - 1]?.id ?? null;
  }
  return null;
}
