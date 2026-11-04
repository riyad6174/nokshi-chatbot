import { z } from "zod";
import { parseRecommendationMap } from "@/modules/catalog/recommendation.service";
import { industryPreset } from "@/modules/sales/presets";

// The AI Sales & Engagement configuration of one store (ChatbotSettings.salesConfig, JSON).
// Everything industry-specific lives here as data (presets are just starting values), so the core
// chatbot logic never hardcodes how a grocery, fashion or electronics store should sell.

export const INDUSTRIES = ["general", "grocery", "fashion", "electronics", "beauty", "home", "sports"] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const INDUSTRY_LABELS: Record<Industry, string> = {
  general: "General store",
  grocery: "Grocery & food",
  fashion: "Fashion & apparel",
  electronics: "Electronics",
  beauty: "Beauty & personal care",
  home: "Home & furniture",
  sports: "Sports & outdoors",
};

export const RELATIONSHIP_KINDS = ["complementary", "complete_the_look", "compatible", "recipe", "bundle"] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

export const ENGAGEMENT_TRIGGERS = ["search", "product_view", "compare", "add_to_cart", "cart_idle", "checkout_start"] as const;
export type EngagementTrigger = (typeof ENGAGEMENT_TRIGGERS)[number];

export const STRATEGIES = ["balanced", "complementary_first", "budget_first", "premium_first", "similar_first"] as const;

const text = (max: number) => z.string().trim().max(max);
const term = z.string().trim().min(1).max(80);

export const relationshipSchema = z.object({
  /** A category or product keyword the rule starts from, e.g. "Shirts", "Phones", "Potato". */
  from: term,
  /** Categories or keywords to suggest with it. */
  to: z.array(term).min(1).max(12),
  kind: z.enum(RELATIONSHIP_KINDS).default("complementary"),
  /** Why, in the customer's terms. "{from}" and "{to}" are replaced. */
  reason: text(160).default(""),
});
export type Relationship = z.infer<typeof relationshipSchema>;

export const recipeSchema = z.object({
  name: term,
  ingredients: z.array(term).min(1).max(20),
});
export type Recipe = z.infer<typeof recipeSchema>;

const triggerSchema = z.object({
  enabled: z.boolean().default(false),
  /** Wait this long after the activity before suggesting (lets the customer look first). */
  delaySeconds: z.number().int().min(0).max(1800).default(0),
});

const triggersSchema = z
  .object(Object.fromEntries(ENGAGEMENT_TRIGGERS.map((name) => [name, triggerSchema.default({})])) as Record<
    EngagementTrigger,
    z.ZodDefault<typeof triggerSchema>
  >)
  .default({});

export const salesConfigSchema = z.object({
  version: z.literal(1).default(1),
  /** Off: the assistant behaves exactly as before (base rules + the generic sales playbook). */
  enabled: z.boolean().default(true),
  industry: z.enum(INDUSTRIES).default("general"),
  businessType: text(120).default(""),
  persona: z
    .object({
      role: text(200).default(""),
      personality: text(600).default(""),
    })
    .default({}),
  conversationRules: z.array(text(300).min(1)).max(20).default([]),
  recommendation: z
    .object({
      strategy: z.enum(STRATEGIES).default("balanced"),
      maxPerReply: z.number().int().min(1).max(6).default(3),
      /** Add-on suggestions the assistant may make on its own per conversation (the customer can always ask for more). */
      maxAddOnsPerConversation: z.number().int().min(0).max(10).default(2),
      explainReasons: z.boolean().default(true),
    })
    .default({}),
  relationships: z.array(relationshipSchema).max(80).default([]),
  recipes: z.array(recipeSchema).max(80).default([]),
  /** Colour coordination, e.g. {"white": ["beige", "navy"]}. */
  colorPairings: z.record(term, z.array(term).max(12)).default({}),
  /** Product attributes that say what an item works with, e.g. compatible_with, connector, model. */
  compatibilityAttributes: z.array(term).max(12).default([]),
  /** Extra search synonyms for this store, e.g. {"aloo": ["potato"]}. */
  synonyms: z.record(term, z.array(term).max(10)).default({}),
  engagement: z
    .object({
      enabled: z.boolean().default(false),
      triggers: triggersSchema,
      maxPerSession: z.number().int().min(0).max(20).default(3),
      minSecondsBetween: z.number().int().min(0).max(3600).default(120),
      suppressDuringCheckout: z.boolean().default(true),
      /** Show a small nudge next to the launcher when the chat is closed. */
      nudgeWhenClosed: z.boolean().default(true),
    })
    .default({}),
  /** Proactive message templates. Placeholders: {product} {suggestions} {recipe}. */
  messages: z
    .object({
      recipe: text(240).default(""),
      complete_the_look: text(240).default(""),
      compatible: text(240).default(""),
      complementary: text(240).default(""),
      cart_idle: text(240).default(""),
      checkout_start: text(240).default(""),
    })
    .default({}),
  salesGoals: z
    .object({
      /** How actively the assistant moves a decided customer to the order. */
      checkoutGuidance: z.enum(["gentle", "direct", "off"]).default("gentle"),
      freeShippingNudge: z.boolean().default(true),
      upsell: z.boolean().default(true),
      notes: text(600).default(""),
    })
    .default({}),
  handoff: z
    .object({
      /** Offer a human for carts at or above this value (minor units); null = never. */
      highValueCartMinor: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
      /** Offer a human when the customer stays unsure after two suggestions. */
      offerWhenUndecided: z.boolean().default(false),
    })
    .default({}),
  features: z
    .object({
      /** Let the AI see images and PDFs the customer attaches (needs a vision-capable model). */
      attachmentUnderstanding: z.boolean().default(true),
      /** Use embeddings for search when EMBEDDINGS_* is configured. */
      semanticSearch: z.boolean().default(true),
    })
    .default({}),
});

export type SalesConfig = z.infer<typeof salesConfigSchema>;
export type SalesConfigInput = z.input<typeof salesConfigSchema>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Deep merge for config objects: objects merge, arrays and scalars from `override` replace. */
export function mergeConfig<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return (override === undefined ? base : override) as T;
  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    output[key] = isPlainObject(output[key]) && isPlainObject(value) ? mergeConfig(output[key], value) : value;
  }
  return output as T;
}

function parseStored(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The effective configuration for a store: its industry preset with the owner's saved overrides on
 * top, validated. Invalid stored values never break the chat: they fall back to the preset.
 * The legacy "complementary categories" map is merged in as complementary relationships.
 */
export function resolveSalesConfig(
  settings: { salesConfig?: string | null; recommendationMap?: string | null } | null | undefined,
): SalesConfig {
  const stored = parseStored(settings?.salesConfig);
  const industry = INDUSTRIES.includes(stored.industry as Industry) ? (stored.industry as Industry) : "general";
  const merged = mergeConfig(industryPreset(industry), stored);
  const parsed = salesConfigSchema.safeParse(merged);
  const config = parsed.success ? parsed.data : salesConfigSchema.parse(industryPreset(industry));

  const legacy = parseRecommendationMap(settings?.recommendationMap);
  if (legacy.size > 0) {
    const existing = new Set(config.relationships.map((rule) => rule.from.toLowerCase()));
    for (const [from, to] of legacy) {
      if (!existing.has(from)) config.relationships.push({ from, to, kind: "complementary", reason: "" });
    }
  }
  return config;
}

/** Validates an admin-submitted configuration (throws ZodError with field paths). */
export function validateSalesConfig(input: unknown): SalesConfig {
  return salesConfigSchema.parse(input);
}

/** A fresh configuration from an industry preset. */
export function presetConfig(industry: Industry): SalesConfig {
  return salesConfigSchema.parse(industryPreset(industry));
}
