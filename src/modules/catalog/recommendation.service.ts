import { prisma } from "@/lib/db/prisma";
import {
  effectivePriceMinor,
  isProductAvailable,
  parseOptions,
  serializeProduct,
  type ProductWithVariants,
} from "@/modules/catalog/product.service";
import { parseJsonObject } from "@/modules/stores/store.service";
import type { ProductCardData } from "@/types/chat";

export type RecommendationKind = "similar" | "cheaper" | "complementary";

/** Admin-defined cross-sell map, e.g. {"Backpacks": ["Water bottles", "Rain covers"]}, keyed case-insensitively. */
export function parseRecommendationMap(value: string | null | undefined): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [category, targets] of Object.entries(parseJsonObject(value))) {
    if (!Array.isArray(targets)) continue;
    const list = targets.filter((target): target is string => typeof target === "string" && target.trim().length > 0);
    if (list.length > 0) map.set(category.trim().toLowerCase(), list.map((target) => target.trim().toLowerCase()));
  }
  return map;
}

function attributeOverlap(a: ProductWithVariants, b: ProductWithVariants): number {
  const left = parseOptions(a.attributes);
  const right = parseOptions(b.attributes);
  let score = 0;
  for (const [key, value] of Object.entries(left)) {
    if (right[key] && right[key]!.toLowerCase() === value.toLowerCase()) score += 1;
  }
  if (a.brand && a.brand === b.brand) score += 1;
  return score;
}

/**
 * Catalog-only recommendations (no invented facts): similar items, cheaper alternatives, or add-ons
 * that go with what the customer is looking at or already has in the cart.
 */
export async function recommendProducts(input: {
  storeId: string;
  kind: RecommendationKind;
  anchorProductIds: string[];
  excludeProductIds?: string[];
  recommendationMap?: string | null;
  limit?: number;
}): Promise<ProductCardData[]> {
  const limit = Math.min(Math.max(input.limit ?? 3, 1), 6);
  const products = await prisma.product.findMany({
    where: { storeId: input.storeId, status: "active" },
    include: { variants: true },
  });
  const anchors = products.filter((product) => input.anchorProductIds.includes(product.id));
  if (anchors.length === 0) return [];

  const excluded = new Set([...input.anchorProductIds, ...(input.excludeProductIds ?? [])]);
  const candidates = products.filter((product) => !excluded.has(product.id) && isProductAvailable(product));
  const anchorCategories = new Set(anchors.map((anchor) => anchor.category.toLowerCase()));
  const anchorPrice = Math.max(...anchors.map(effectivePriceMinor));

  let ranked: ProductWithVariants[];
  if (input.kind === "similar") {
    ranked = candidates
      .filter((product) => anchorCategories.has(product.category.toLowerCase()))
      .map((product) => ({
        product,
        score:
          Math.max(...anchors.map((anchor) => attributeOverlap(anchor, product))) * 1000 -
          Math.abs(effectivePriceMinor(product) - anchorPrice) / Math.max(anchorPrice, 1),
      }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.product);
  } else if (input.kind === "cheaper") {
    ranked = candidates
      .filter((product) => anchorCategories.has(product.category.toLowerCase()) && effectivePriceMinor(product) < anchorPrice)
      .sort((a, b) => effectivePriceMinor(b) - effectivePriceMinor(a));
  } else {
    const map = parseRecommendationMap(input.recommendationMap);
    const mapped = new Set(anchors.flatMap((anchor) => map.get(anchor.category.toLowerCase()) ?? []));
    const fromMap = candidates.filter((product) => mapped.has(product.category.toLowerCase()));
    // No mapping configured: suggest a modest add-on from another category.
    ranked = (fromMap.length > 0
      ? fromMap
      : candidates.filter(
          (product) => !anchorCategories.has(product.category.toLowerCase()) && effectivePriceMinor(product) <= anchorPrice * 0.6,
        )
    ).sort((a, b) => effectivePriceMinor(a) - effectivePriceMinor(b));
  }

  return ranked.slice(0, limit).map(serializeProduct);
}
