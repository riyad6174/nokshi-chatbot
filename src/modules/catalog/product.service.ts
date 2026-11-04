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

export async function searchProducts(input: ProductSearchInput): Promise<ProductCardData[]> {
  const limit = Math.min(Math.max(input.limit ?? 6, 1), 12);
  const products = await prisma.product.findMany({
    where: { storeId: input.storeId, status: "active" },
    include: { variants: true },
    orderBy: { name: "asc" },
  });

  const query = input.text?.trim().toLowerCase() ?? "";
  const tokens = query.split(/\s+/).filter((token) => token.length > 1);
  const category = input.category?.trim().toLowerCase() ?? "";

  const scored = products
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
        for (const token of tokens) {
          if (product.name.toLowerCase().includes(token)) score += 3;
          else if (haystack.includes(token)) score += 1;
        }
        const semantic = input.semanticScores?.get(product.id) ?? 0;
        if (score === 0) {
          const allTokensMatch = tokens.every((token) => haystack.includes(token));
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

  return scored;
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
