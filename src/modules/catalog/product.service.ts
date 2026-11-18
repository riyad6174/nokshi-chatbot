import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { ProductCardData, ProductVariantData } from "@/types/chat";
import { isObjectId } from "@/lib/db/ids";

export type ProductWithVariants = Prisma.ProductGetPayload<{ include: { variants: true } }>;

export function parseOptions(value: string | null | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, entry]) => [key, String(entry)]),
    );
  } catch {
    return {};
  }
}

export function variantPriceMinor(product: Pick<ProductWithVariants, "priceMinor">, variant?: { priceOverrideMinor: number | null } | null) {
  if (variant?.priceOverrideMinor != null) return variant.priceOverrideMinor;
  return product.priceMinor;
}

export function variantAvailable(variant: { stockStatus: string; stockQuantity: number | null }): boolean {
  if (variant.stockStatus === "out_of_stock") return false;
  if (variant.stockQuantity != null && variant.stockQuantity <= 0) return false;
  return true;
}

export function effectivePriceMinor(product: ProductWithVariants): number {
  if (product.variants.length === 0) return product.priceMinor;
  // Price from what can actually be bought, so budget filters don't match a sold-out cheap variant.
  const available = product.variants.filter(variantAvailable);
  const priced = available.length > 0 ? available : product.variants;
  return Math.min(...priced.map((variant) => variantPriceMinor(product, variant)));
}

export function isProductAvailable(product: ProductWithVariants): boolean {
  if (product.status !== "active") return false;
  if (product.variants.length === 0) return true;
  return product.variants.some((variant) => variantAvailable(variant));
}

export function serializeProduct(product: ProductWithVariants): ProductCardData {
  const variants: ProductVariantData[] = product.variants.map((variant) => ({
    id: variant.id,
    sku: variant.sku,
    title: variant.title,
    options: parseOptions(variant.options),
    priceMinor: variantPriceMinor(product, variant),
    stockStatus: variant.stockStatus,
    available: variantAvailable(variant),
  }));

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    category: product.category,
    brand: product.brand,
    attributes: parseOptions(product.attributes),
    imageUrl: product.imageUrl,
    priceMinor: effectivePriceMinor(product),
    currency: product.currency,
    available: isProductAvailable(product),
    variants,
  };
}

export type ProductSearchInput = {
  storeId: string;
  text?: string;
  category?: string;
  maxPriceMinor?: number;
  minPriceMinor?: number;
  brand?: string;
  /** Narrow by variant option or product attribute, e.g. { color: "Black", material: "canvas" }. */
  filters?: Record<string, string>;
  limit?: number;
  includeUnavailable?: boolean;
  /** Semantic similarity per product id (0..1) from embeddings; products in it match even without shared words. */
  semanticScores?: Map<string, number>;
};

function matchesFilters(product: ProductWithVariants, filters: Record<string, string>): boolean {
  const attributes = Object.fromEntries(
    Object.entries(parseOptions(product.attributes)).map(([key, value]) => [key.toLowerCase(), value.toLowerCase()]),
  );
  return Object.entries(filters).every(([rawKey, rawValue]) => {
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.trim().toLowerCase();
    if (!key || !value) return true;
    // Variant options (color, size) must match on an available variant.
    const variantMatch = product.variants.some((variant) => {
      if (!variantAvailable(variant)) return false;
      const options = parseOptions(variant.options);
      return Object.entries(options).some(([optionKey, optionValue]) => optionKey.toLowerCase() === key && optionValue.toLowerCase().includes(value));
    });
    return variantMatch || (attributes[key]?.includes(value) ?? false);
  });
}

export type Facet = { name: string; values: string[] };

/**
 * Values the customer can narrow by, from the products just found: brand, variant options
 * (color, size, ...) and a few common attributes. Only facets with 2+ values are useful.
 */
export function computeFacets(products: ProductCardData[], maxPerFacet = 6): Facet[] {
  const buckets = new Map<string, Set<string>>();
  const add = (name: string, value: string) => {
    const clean = value.trim();
    if (!clean || clean.length > 40) return;
    const bucket = buckets.get(name) ?? new Set<string>();
    bucket.add(clean);
    buckets.set(name, bucket);
  };
  for (const product of products) {
    if (product.brand) add("brand", product.brand);
    for (const variant of product.variants) {
      if (!variant.available) continue;
      for (const [key, value] of Object.entries(variant.options)) add(key.toLowerCase(), value);
    }
    for (const key of ["material", "fabric", "capacity"]) {
      const value = Object.entries(product.attributes).find(([attributeKey]) => attributeKey.toLowerCase() === key)?.[1];
      if (value) add(key, value);
    }
  }
  return [...buckets.entries()]
    .filter(([, values]) => values.size >= 2)
    .map(([name, values]) => ({ name, values: [...values].slice(0, maxPerFacet) }))
    .slice(0, 4);
}

/** A search word and its singular ("bags" also finds "bag", "watches" finds "watch"). */
export function termForms(token: string): string[] {
  if (token.length > 4 && /(ches|shes|xes|sses)$/.test(token)) return [token, token.slice(0, -2)];
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return [token, token.slice(0, -1)];
  return [token];
}

/** True when the two words differ by at most one inserted, removed, swapped-for or transposed letter. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) {
    // One substitution, or two neighbouring letters swapped.
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
  return longer.slice(i + 1) === shorter.slice(i);
}

// The active catalog per store, kept briefly in memory: one product search can scan it several times
// (browse, synonyms, one term at a time) and every chat turn searches. Product and stock writes clear
// it (invalidateCatalog); the short lifetime covers other instances and anything not hooked up.
const catalogCache = new Map<string, { at: number; products: Promise<ProductWithVariants[]> }>();

function catalogTtlMs(): number {
  const configured = Number(process.env.CATALOG_CACHE_TTL_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : 30_000;
}

/** All active products of a store with their variants, by name. */
export function loadActiveCatalog(storeId: string): Promise<ProductWithVariants[]> {
  const query = () =>
    prisma.product.findMany({ where: { storeId, status: "active" }, include: { variants: true }, orderBy: { name: "asc" } });
  const ttl = catalogTtlMs();
  if (ttl === 0) return query();
  const cached = catalogCache.get(storeId);
  if (cached && Date.now() - cached.at < ttl) return cached.products;
  const products = query().catch((error) => {
    catalogCache.delete(storeId);
    throw error;
  });
  catalogCache.set(storeId, { at: Date.now(), products });
  return products;
}

/** Forget the cached catalog after products, variants or stock change (all stores when no id). */
export function invalidateCatalog(storeId?: string) {
  if (storeId) catalogCache.delete(storeId);
  else catalogCache.clear();
}

export async function searchProducts(input: ProductSearchInput): Promise<ProductCardData[]> {
  const limit = Math.min(Math.max(input.limit ?? 6, 1), 24);
  const products = await loadActiveCatalog(input.storeId);

  const query = input.text?.trim().toLowerCase() ?? "";
  const tokens = query.split(/\s+/).filter((token) => token.length > 1);
  const category = input.category?.trim().toLowerCase() ?? "";

  // Typo matching only when nothing matched as written: "shirt" must not also bring up "short".
  const rank = (fuzzy: boolean) => products
    .map((product) => {
      const price = effectivePriceMinor(product);
      const attributesText = product.attributes.toLowerCase();
      const variantText = product.variants.map((variant) => `${variant.title} ${variant.options}`).join(" ");
      const haystack = `${product.name} ${product.brand} ${product.category} ${product.description} ${attributesText} ${variantText}`.toLowerCase();
      let score = 0;

      if (query) {
        if (product.name.toLowerCase() === query) score += 20;
        else if (product.name.toLowerCase().includes(query)) score += 10;
        if (product.category.toLowerCase() === query) score += 8;
        else if (product.category.toLowerCase().includes(query)) score += 4;
        if (attributesText.includes(query)) score += 3;
        if (product.description.toLowerCase().includes(query)) score += 3;
        const name = product.name.toLowerCase();
        const nameWords = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        const tokenFound = tokens.map((token) => {
          const forms = termForms(token);
          if (forms.some((form) => name.includes(form))) return 3;
          if (forms.some((form) => haystack.includes(form))) return 1;
          // A typo in a product name ("backpak", "scraf").
          if (fuzzy && token.length >= 5 && nameWords.some((word) => withinOneEdit(word, token))) return 2;
          return 0;
        });
        for (const found of tokenFound) score += found;
        const semantic = input.semanticScores?.get(product.id) ?? 0;
        if (score === 0) {
          const allTokensMatch = tokenFound.every((found) => found > 0);
          if (!allTokensMatch && semantic === 0) return null;
          score = allTokensMatch ? 1 : 0;
        }
        // Hybrid ranking: keyword score plus semantic closeness.
        score += semantic * 12;
      }

      if (category && !product.category.toLowerCase().includes(category)) return null;
      if (input.maxPriceMinor != null && price > input.maxPriceMinor) return null;
      if (input.minPriceMinor != null && price < input.minPriceMinor) return null;
      if (input.brand && !product.brand.toLowerCase().includes(input.brand.trim().toLowerCase())) return null;
      if (input.filters && !matchesFilters(product, input.filters)) return null;
      if (!input.includeUnavailable && !isProductAvailable(product)) return null;

      return { product, score, price };
    })
    .filter((entry): entry is { product: ProductWithVariants; score: number; price: number } => entry !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.price - b.price;
    })
    .slice(0, limit)
    .map((entry) => serializeProduct(entry.product));

  const exact = rank(false);
  return exact.length > 0 || tokens.length === 0 ? exact : rank(true);
}

export async function getProductById(storeId: string, productId: string): Promise<ProductCardData | null> {
  if (!isObjectId(productId)) return null;
  const product = await prisma.product.findFirst({
    where: { id: productId, storeId, status: "active" },
    include: { variants: true },
  });
  return product ? serializeProduct(product) : null;
}

export async function listProductsForAdmin(storeId: string) {
  return prisma.product.findMany({
    where: { storeId },
    include: { variants: { orderBy: { title: "asc" } } },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
}

export async function getProductForAdmin(storeId: string, productId: string) {
  if (!isObjectId(productId)) return null;
  return prisma.product.findFirst({
    where: { id: productId, storeId },
    include: { variants: { orderBy: { title: "asc" } } },
  });
}
