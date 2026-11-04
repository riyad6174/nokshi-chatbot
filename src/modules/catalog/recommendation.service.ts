import { prisma } from "@/lib/db/prisma";
import { priceLabel } from "@/lib/money";
import {
  effectivePriceMinor,
  isProductAvailable,
  serializeProduct,
  type ProductWithVariants,
} from "@/modules/catalog/product.service";
import type { Relationship, RelationshipKind, SalesConfig } from "@/modules/sales/config";
import { productColors, productMatchesTerm, stems, termMatches } from "@/modules/sales/matching";
import { parseJsonObject } from "@/modules/stores/store.service";
import type { ProductCardData } from "@/types/chat";

// Hybrid, catalog-only recommendations. Candidates always come from the store's active, in-stock
// products within the customer's budget; the configured relationships (complete-the-look, compatible,
// recipes, bundles), product attributes, keyword overlap and (when present) embeddings rank them.
// Every reason is built here from catalog data, so the AI explains suggestions without inventing facts.

export const RECOMMENDATION_KINDS = [
  "similar",
  "cheaper",
  "complementary",
  "complete_the_look",
  "compatible",
  "recipe",
  "bundle",
  "personalized",
] as const;
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];

/** Kinds that suggest something extra (an add-on), as opposed to an alternative. */
export const ADD_ON_KINDS: ReadonlySet<RecommendationKind> = new Set(["complementary", "complete_the_look", "compatible", "recipe", "bundle"]);

export type Recommendation = {
  product: ProductCardData;
  /** Why it's suggested, from catalog data and the store's rules. */
  reason: string;
  score: number;
  /** Which signal produced it: rule, color, compatibility, recipe, attributes, keywords, semantic, fallback. */
  source: string;
  /** compatible kind: whether the catalog states compatibility (false = no limits listed). */
  compatibilityVerified?: boolean;
};

export type RecommendInput = {
  storeId: string;
  kind: RecommendationKind;
  anchorProductIds: string[];
  excludeProductIds?: string[];
  /** Legacy category map ({"Backpacks": ["Water bottles"]}); used when no config is given. */
  recommendationMap?: string | null;
  config?: SalesConfig | null;
  /** What the customer wants it for: a dish, occasion or use ("potato curry", "office"). */
  need?: string;
  maxPriceMinor?: number;
  minPriceMinor?: number;
  interests?: string[];
  limit?: number;
};

export type RecommendResult = {
  recommendations: Recommendation[];
  anchors: ProductCardData[];
  /** recipe kind: the dish the suggestions are for, and other dishes that use the anchor. */
  recipe?: string | null;
  recipeOptions?: string[];
};

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

type Candidate = { raw: ProductWithVariants; card: ProductCardData; price: number };
type Scored = { candidate: Candidate; score: number; reason: string; source: string; compatibilityVerified?: boolean };

const DEFAULT_COMPAT_KEYS = ["compatible_with", "compatibility", "connector", "port", "model"];

const DEFAULT_REASONS: Record<RelationshipKind, string> = {
  complementary: "Goes well with {from}",
  complete_the_look: "Completes the look with {from}",
  compatible: "Works with {from}",
  recipe: "For {from}",
  bundle: "Pairs with {from}",
};

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

function normalizeId(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function splitValues(value: string): string[] {
  return value
    .split(/[,;/|]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index]! * b[index]!;
    na += a[index]! * a[index]!;
    nb += b[index]! * b[index]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

function keywordOverlap(a: string, b: string): number {
  const left = new Set(stems(a));
  if (left.size === 0) return 0;
  let shared = 0;
  for (const word of new Set(stems(b))) if (left.has(word)) shared += 1;
  return shared;
}

function productText(card: ProductCardData): string {
  return `${card.name} ${card.category} ${card.brand} ${Object.values(card.attributes).join(" ")} ${card.description.slice(0, 300)}`;
}

function rulesFromMap(map: Map<string, string[]>): Relationship[] {
  return [...map.entries()].map(([from, to]) => ({ from, to, kind: "complementary" as const, reason: "" }));
}

/** Compatibility values a product declares, e.g. {compatible_with: ["Phone X"], connector: ["USB-C"]}. */
function compatibilityValues(card: ProductCardData, keys: string[]): Array<{ key: string; value: string }> {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  return Object.entries(card.attributes)
    .filter(([key]) => wanted.has(key.toLowerCase()))
    .flatMap(([key, value]) => splitValues(value).map((entry) => ({ key, value: entry })));
}

/** How a candidate relates to the anchor's compatibility: matched, conflicting, or no data. */
function compatibility(anchor: ProductCardData, candidate: ProductCardData, keys: string[]) {
  const declared = compatibilityValues(candidate, keys);
  if (declared.length === 0) return { state: "unknown" as const };
  const identity = [anchor.name, `${anchor.brand} ${anchor.name}`, ...compatibilityValues(anchor, keys).map((entry) => entry.value)]
    .map(normalizeId)
    .filter((entry) => entry.length >= 2);
  for (const entry of declared) {
    const value = normalizeId(entry.value);
    if (value === "universal" || value === "all") return { state: "match" as const, key: entry.key, value: entry.value };
    if (value.length >= 2 && identity.some((id) => id === value || id.includes(value))) {
      return { state: "match" as const, key: entry.key, value: entry.value };
    }
  }
  return { state: "conflict" as const };
}

export async function recommend(input: RecommendInput): Promise<RecommendResult> {
  const config = input.config ?? null;
  const limit = Math.min(Math.max(input.limit ?? config?.recommendation.maxPerReply ?? 3, 1), 6);
  const products = await prisma.product.findMany({
    where: { storeId: input.storeId, status: "active" },
    include: { variants: true },
  });
  const anchorsRaw = products.filter((product) => input.anchorProductIds.includes(product.id));
  const anchors = anchorsRaw.map(serializeProduct);
  const excluded = new Set([...input.anchorProductIds, ...(input.excludeProductIds ?? [])]);
  const candidates: Candidate[] = products
    .filter((product) => !excluded.has(product.id) && isProductAvailable(product))
    .map((raw) => ({ raw, card: serializeProduct(raw), price: effectivePriceMinor(raw) }))
    .filter(
      (candidate) =>
        (input.maxPriceMinor == null || candidate.price <= input.maxPriceMinor) &&
        (input.minPriceMinor == null || candidate.price >= input.minPriceMinor),
    );

  const relationships = config ? config.relationships : rulesFromMap(parseRecommendationMap(input.recommendationMap));
  const compatKeys = config?.compatibilityAttributes.length ? config.compatibilityAttributes : DEFAULT_COMPAT_KEYS;
  const anchorPrice = anchorsRaw.length > 0 ? Math.max(...anchorsRaw.map(effectivePriceMinor)) : 0;
  const currency = anchors[0]?.currency ?? candidates[0]?.card.currency ?? "BDT";

  const related = (kinds: RelationshipKind[] | null, colorAware: boolean): Scored[] => {
    const out: Scored[] = [];
    const knownColors = config ? [...new Set([...Object.keys(config.colorPairings), ...Object.values(config.colorPairings).flat()])] : [];
    for (const anchor of anchors) {
      const rules = relationships.filter((rule) => (!kinds || kinds.includes(rule.kind)) && productMatchesTerm(anchor, rule.from));
      const anchorColors = colorAware && config ? productColors(anchor, knownColors) : [];
      const paired = new Set(anchorColors.flatMap((color) => config?.colorPairings[color] ?? []).map((color) => color.toLowerCase()));
      for (const rule of rules) {
        rule.to.forEach((target, targetIndex) => {
          for (const candidate of candidates) {
            if (!productMatchesTerm(candidate.card, target)) continue;
            // An accessory that states what it works with must fit this anchor.
            const compat = compatibility(anchor, candidate.card, compatKeys);
            if (compat.state === "conflict") continue;
            let score = 100 - targetIndex * 4;
            let reason = fill(rule.reason || DEFAULT_REASONS[rule.kind], { from: anchor.name, to: candidate.card.name });
            let source = "rule";
            if (compat.state === "match") {
              score += 20;
              reason = `Compatible with ${anchor.name} (${compat.key}: ${compat.value})`;
              source = "compatibility";
            }
            if (paired.size > 0) {
              const colors = productColors(candidate.card, knownColors);
              const match = colors.find((color) => paired.has(color));
              if (match) {
                score += 30;
                reason = `${capitalize(match)} pairs well with ${anchorColors.join("/")}: ${lowerFirst(reason)}`;
                source = "color";
              } else if (colors.some((color) => anchorColors.includes(color)) && !paired.has(colors[0] ?? "")) {
                score -= 10;
              }
            }
            out.push({ candidate, score, reason, source, compatibilityVerified: compat.state === "match" ? true : undefined });
          }
        });
      }
    }
    return out;
  };

  let scored: Scored[] = [];
  let recipe: string | null = null;
  let recipeOptions: string[] = [];

  switch (input.kind) {
    case "similar": {
      for (const candidate of candidates) {
        for (const anchor of anchorsRaw) {
          const sameCategory = candidate.card.category.toLowerCase() === anchor.category.toLowerCase();
          const overlap = keywordOverlap(productText(serializeProduct(anchor)), productText(candidate.card));
          const semantic = cosine(anchor.embedding ?? [], candidate.raw.embedding ?? []);
          if (!sameCategory && overlap < 2 && semantic < 0.8) continue;
          const anchorAttrs = serializeProduct(anchor).attributes;
          const shared = Object.entries(anchorAttrs).filter(
            ([key, value]) => candidate.card.attributes[key]?.toLowerCase() === value.toLowerCase(),
          );
          const closeness = 1 - Math.min(Math.abs(candidate.price - anchorPrice) / Math.max(anchorPrice, 1), 1);
          const score = (sameCategory ? 50 : 0) + shared.length * 10 + overlap * 3 + semantic * 40 + closeness * 10;
          const reason = `Another ${candidate.card.category.toLowerCase()} option like ${anchor.name}${
            shared.length > 0 ? `, also ${shared.map(([key, value]) => `${key} ${value}`).slice(0, 2).join(", ")}` : ""
          }`;
          scored.push({ candidate, score, reason, source: semantic >= 0.8 ? "semantic" : shared.length > 0 ? "attributes" : "keywords" });
        }
      }
      break;
    }
    case "cheaper": {
      const categories = new Set(anchorsRaw.map((anchor) => anchor.category.toLowerCase()));
      for (const candidate of candidates) {
        if (!categories.has(candidate.card.category.toLowerCase()) || candidate.price >= anchorPrice) continue;
        const saving = anchorPrice - candidate.price;
        scored.push({
          candidate,
          // Closest cheaper option first: a real alternative, not the cheapest thing in the category.
          score: 100 - (saving / Math.max(anchorPrice, 1)) * 50,
          reason: `${priceLabel(saving, currency)} less than ${anchors[0]?.name ?? "your pick"}`,
          source: "price",
        });
      }
      break;
    }
    case "compatible": {
      for (const anchor of anchors) {
        for (const candidate of candidates) {
          const compat = compatibility(anchor, candidate.card, compatKeys);
          if (compat.state === "match") {
            scored.push({
              candidate,
              score: 120,
              reason: `Compatible with ${anchor.name} (${compat.key}: ${compat.value})`,
              source: "compatibility",
              compatibilityVerified: true,
            });
          }
        }
      }
      // Rule-based accessories without stated limits come after verified ones.
      for (const entry of related(["compatible", "complementary", "bundle"], false)) {
        if (entry.compatibilityVerified) continue;
        scored.push({ ...entry, score: entry.score - 60, compatibilityVerified: false, reason: `${entry.reason} (no compatibility limits listed)` });
      }
      break;
    }
    case "complete_the_look": {
      scored = related(["complete_the_look"], true);
      if (scored.length === 0) scored = related(null, true);
      break;
    }
    case "recipe": {
      const recipes = config?.recipes ?? [];
      const need = input.need?.trim() ?? "";
      const byNeed = need ? recipes.filter((entry) => termMatches(entry.name, need) || termMatches(need, entry.name)) : [];
      const byAnchor = recipes.filter((entry) =>
        entry.ingredients.some((ingredient) => anchors.some((anchor) => productMatchesTerm(anchor, ingredient))),
      );
      const byNeedIngredient = need
        ? recipes.filter((entry) => entry.ingredients.some((ingredient) => termMatches(ingredient, need)))
        : [];
      const options = [...new Set([...byNeed, ...byAnchor, ...byNeedIngredient])];
      recipeOptions = options.map((entry) => entry.name).slice(0, 4);
      const chosen = byNeed[0] ?? byAnchor[0] ?? byNeedIngredient[0];
      if (chosen) {
        recipe = chosen.name;
        chosen.ingredients.forEach((ingredient, index) => {
          if (anchors.some((anchor) => productMatchesTerm(anchor, ingredient))) return;
          const matches = candidates
            .filter((candidate) => productMatchesTerm(candidate.card, ingredient, true))
            .sort((a, b) => a.price - b.price);
          const best = matches[0];
          if (best) scored.push({ candidate: best, score: 100 - index * 3, reason: `For ${chosen.name}: ${ingredient}`, source: "recipe" });
        });
      }
      if (scored.length === 0) scored = related(null, false);
      break;
    }
    case "bundle": {
      // A complete solution: the best item for each related need, one per target.
      const all = related(null, true).sort((a, b) => b.score - a.score);
      const usedCategories = new Set<string>();
      for (const entry of all) {
        const category = entry.candidate.card.category.toLowerCase();
        if (usedCategories.has(category)) continue;
        usedCategories.add(category);
        scored.push(entry);
      }
      break;
    }
    case "personalized": {
      const signals = [...(input.interests ?? []), input.need ?? ""].filter(Boolean).join(" ");
      const categories = new Set(anchorsRaw.map((anchor) => anchor.category.toLowerCase()));
      for (const candidate of candidates) {
        const overlap = signals ? keywordOverlap(signals, productText(candidate.card)) : 0;
        const sameCategory = categories.has(candidate.card.category.toLowerCase());
        if (overlap === 0 && !sameCategory) continue;
        const interest = (input.interests ?? []).find((value) => keywordOverlap(value, productText(candidate.card)) > 0);
        scored.push({
          candidate,
          score: overlap * 20 + (sameCategory ? 10 : 0),
          reason: interest ? `Matches your interest in ${interest}` : `More ${candidate.card.category.toLowerCase()} you may like`,
          source: "keywords",
        });
      }
      break;
    }
    case "complementary":
    default: {
      scored = related(null, Boolean(config && Object.keys(config.colorPairings).length > 0));
      if (scored.length === 0 && config?.recipes.length) {
        return recommend({ ...input, kind: "recipe" });
      }
      if (scored.length === 0 && anchorsRaw.length > 0) {
        // No rules configured: a modest add-on from another category.
        const categories = new Set(anchorsRaw.map((anchor) => anchor.category.toLowerCase()));
        for (const candidate of candidates) {
          if (categories.has(candidate.card.category.toLowerCase()) || candidate.price > anchorPrice * 0.6) continue;
          scored.push({
            candidate,
            score: 10 - candidate.price / Math.max(anchorPrice, 1),
            reason: `A small add-on to go with ${anchors[0]!.name}`,
            source: "fallback",
          });
        }
      }
      break;
    }
  }

  // One entry per product (its best reason), then the store's strategy breaks ties.
  const best = new Map<string, Scored>();
  for (const entry of scored) {
    const current = best.get(entry.candidate.card.id);
    if (!current || entry.score > current.score) best.set(entry.candidate.card.id, entry);
  }
  const strategy = config?.recommendation.strategy ?? "balanced";
  const ranked = [...best.values()].sort((a, b) => {
    const strategyBonus = (entry: Scored) =>
      strategy === "budget_first" ? -entry.candidate.price / Math.max(anchorPrice || entry.candidate.price, 1) * 8 : strategy === "premium_first" ? entry.candidate.price / Math.max(anchorPrice || entry.candidate.price, 1) * 8 : 0;
    const diff = b.score + strategyBonus(b) - (a.score + strategyBonus(a));
    if (Math.abs(diff) > 1e-9) return diff;
    return a.candidate.price - b.candidate.price;
  });

  return {
    anchors,
    recipe,
    recipeOptions,
    recommendations: ranked.slice(0, limit).map((entry) => ({
      product: entry.candidate.card,
      reason: entry.reason,
      score: Math.round(entry.score * 10) / 10,
      source: entry.source,
      ...(entry.compatibilityVerified !== undefined ? { compatibilityVerified: entry.compatibilityVerified } : {}),
    })),
  };
}

/**
 * Catalog-only recommendations (no invented facts): similar items, cheaper alternatives, or add-ons
 * that go with what the customer is looking at or already has in the cart. Kept for existing callers.
 */
export async function recommendProducts(input: {
  storeId: string;
  kind: RecommendationKind;
  anchorProductIds: string[];
  excludeProductIds?: string[];
  recommendationMap?: string | null;
  config?: SalesConfig | null;
  limit?: number;
}): Promise<ProductCardData[]> {
  const result = await recommend(input);
  return result.recommendations.map((entry) => entry.product);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
