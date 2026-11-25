import { prisma } from "@/lib/db/prisma";
import { priceLabel } from "@/lib/money";
import { CartError, getActiveCart, getCartSummary } from "@/modules/cart/cart.service";
import { loadActiveCatalog } from "@/modules/catalog/product.service";
import { translateShoppingTerms } from "@/modules/catalog/query-terms";
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

/**
 * The cart line a tool means: its itemId when that's in the cart; otherwise the line whose product
 * (and version) matches `product` / `variant` by name; otherwise, with a single line in the cart, that
 * line ("remove it"). Ids are long and easy to mis-copy, and a failed call costs another model round.
 */
export async function resolveCartItemId(
  ctx: ToolContext,
  input: { itemId?: string | null; product?: string | null; variant?: string | null },
): Promise<string | null> {
  const cart = await getCartForTool(ctx);
  if (input.itemId && cart.items.some((item) => item.itemId === input.itemId)) return input.itemId;
  const wanted = input.product?.trim().toLowerCase();
  if (wanted) {
    const byName = cart.items.filter((item) => item.name.toLowerCase().includes(wanted) || wanted.includes(item.name.toLowerCase()));
    const variant = input.variant?.trim().toLowerCase();
    const narrowed = variant ? byName.filter((item) => (item.variantTitle ?? "").toLowerCase().includes(variant)) : byName;
    if (narrowed.length === 1) return narrowed[0]!.itemId;
    if (byName.length === 1) return byName[0]!.itemId;
  }
  return cart.items.length === 1 ? cart.items[0]!.itemId : null;
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
 * Active products a spoken or typed name refers to: an exact name first, then names containing it
 * (or contained in it), then Bangla/colloquial words translated to catalog terms ("ব্যাকপ্যাক" ->
 * backpack) matched against names and categories. Several results mean the name is ambiguous.
 */
type CatalogProduct = Awaited<ReturnType<typeof loadActiveCatalog>>[number];

export async function productsMatchingName(storeId: string, name: string, synonyms: Record<string, string[]> = {}): Promise<CatalogProduct[]> {
  const products = await loadActiveCatalog(storeId);
  const wanted = name.trim().toLowerCase();
  if (!wanted) return [];
  const exact = products.filter((product) => product.name.toLowerCase() === wanted);
  if (exact.length) return exact;
  const partial = products.filter((product) => product.name.toLowerCase().includes(wanted) || wanted.includes(product.name.toLowerCase()));
  if (partial.length) return partial;
  const terms = translateShoppingTerms(name, synonyms).toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const byName = products.filter((product) => terms.some((term) => product.name.toLowerCase().includes(term)));
  if (byName.length) return byName;
  return products.filter((product) => terms.some((term) => product.category.toLowerCase().includes(term)));
}

/** Parts saved with the recent assistant/event messages of a conversation, newest message first. */
async function recentParts(conversationId: string): Promise<ChatPart[][]> {
  const rows = await prisma.message.findMany({
    where: { conversationId, role: { in: ["assistant", "event"] } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { structuredContent: true },
  });
  return rows.flatMap((row) => {
    if (!row.structuredContent) return [];
    try {
      const parts = JSON.parse(row.structuredContent) as unknown;
      return Array.isArray(parts) ? [parts as ChatPart[]] : [];
    } catch {
      return [];
    }
  });
}

/**
 * The product being talked about: the latest single-product card (details) or product page opened
 * in this conversation, so "open its page" / "this one" works without the model repeating a name.
 */
export async function focusedProductId(conversationId: string, storeId: string, shownThisTurn: ChatPart[] = []): Promise<string | null> {
  for (const parts of [shownThisTurn, ...(await recentParts(conversationId))]) {
    for (const part of [...parts].reverse()) {
      if (part.type === "product_list" && part.products.length === 1) return part.products[0]!.id;
      if (part.type === "navigate" && part.url.startsWith("/products/")) {
        const slug = decodeURIComponent(part.url.slice("/products/".length).split(/[?#]/)[0] ?? "");
        const product = (await loadActiveCatalog(storeId)).find((entry) => entry.slug === slug);
        if (product) return product.id;
      }
    }
  }
  return null;
}

/**
 * The product at a 1-based position of the latest product list shown in this conversation ("add the
 * second one"), so a number the customer said doesn't depend on the model copying the right id.
 */
export async function productIdAtPosition(conversationId: string, position: number, shownThisTurn: ChatPart[] = []): Promise<string | null> {
  // A list shown earlier in this same reply (not saved yet) is what's on screen now.
  const current = [...shownThisTurn].reverse().find((part) => part.type === "product_list");
  if (current && current.type === "product_list") return current.products[position - 1]?.id ?? null;
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
