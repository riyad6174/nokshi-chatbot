import { z } from "zod";
import { ADD_ON_KINDS, RECOMMENDATION_KINDS, recommend } from "@/modules/catalog/recommendation.service";
import { findProfileForVisitor } from "@/modules/customers/profile.service";
import { resolveSalesConfig } from "@/modules/sales/config";
import { getEngagementState, isOptedOut } from "@/modules/sales/state";
import { recordSuggestions } from "@/modules/sales/tracking";
import { getCartForTool, productCompact, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";

const schema = z.object({
  kind: z.enum(RECOMMENDATION_KINDS),
  productId: z.string().trim().max(100).optional(),
  productIds: z.array(z.string().trim().max(100)).max(5).optional(),
  need: z.string().trim().max(200).optional(),
  maxPriceMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  minPriceMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  customerAsked: z.boolean().optional(),
  limit: z.number().int().min(1).max(6).optional(),
});

const LABELS: Record<(typeof RECOMMENDATION_KINDS)[number], string> = {
  similar: "Similar picks",
  cheaper: "Budget-friendly options",
  complementary: "Goes well with your cart",
  complete_the_look: "Complete the look",
  compatible: "Compatible accessories",
  recipe: "For your recipe",
  bundle: "Complete set",
  personalized: "Picked for you",
};

export const getRecommendationsTool: ToolDefinition = {
  name: "get_recommendations",
  description:
    "Catalog-based suggestions around a product (or the cart when productId is omitted), each with a `reason` built from catalog data. kind: 'similar' (alternatives or substitutes), 'cheaper' (lower-priced alternatives, for price objections), 'complementary' (an add-on that goes with it), 'complete_the_look' (outfit or room pieces that match, with colour coordination), 'compatible' (accessories that fit a device), 'recipe' (other ingredients for a dish; set need to the dish), 'bundle' (a complete set for a need), 'personalized' (from the customer's interests or need). Shows product cards. Respects budget (maxPriceMinor), stock and the store's suggestion limits.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["kind"],
    properties: {
      kind: { type: "string", enum: [...RECOMMENDATION_KINDS] },
      productId: { type: "string", description: "Product to base the suggestions on; defaults to the cart's items." },
      productIds: { type: "array", items: { type: "string" }, maxItems: 5, description: "Several anchor products." },
      need: { type: "string", description: "What it's for in the customer's words: a dish ('potato curry'), occasion ('office'), or use ('gaming')." },
      maxPriceMinor: { type: "integer", minimum: 0, description: "Budget per item in minor units (300000 = 3,000 BDT)." },
      minPriceMinor: { type: "integer", minimum: 0 },
      customerAsked: { type: "boolean", description: "True only when the customer asked for suggestions in their latest message." },
      limit: { type: "integer", minimum: 1, maximum: 6, description: "Default from store settings (usually 3)." },
    },
  },
  schema,
  async execute(ctx, args) {
    const input = schema.parse(args);
    const { session } = ctx;
    const config = resolveSalesConfig(session.store.settings);
    const cart = await getCartForTool(ctx);
    const cartProductIds = cart.items.map((item) => item.productId);
    const state = await getEngagementState(session.sessionId);
    const isAddOn = ADD_ON_KINDS.has(input.kind);

    // The store's limits and the customer's wishes apply to suggestions the AI makes on its own.
    if (isAddOn && !input.customerAsked) {
      if (await isOptedOut({ storeId: session.storeId, visitorId: session.visitorId, state })) {
        return success({ suppressed: true, products: [], note: "The customer asked for no more suggestions. Don't suggest add-ons unless they ask." });
      }
      if (config.enabled && state.addOnCount >= config.recommendation.maxAddOnsPerConversation) {
        return success({ suppressed: true, products: [], note: "Add-on limit for this visit reached. Only suggest more if the customer asks." });
      }
    }

    const anchors = input.productIds?.length ? input.productIds : input.productId ? [input.productId] : cartProductIds;
    const profile = input.kind === "personalized" ? await findProfileForVisitor(session.storeId, session.visitorId) : null;
    const result = await recommend({
      storeId: session.storeId,
      kind: input.kind,
      anchorProductIds: anchors,
      excludeProductIds: [...cartProductIds, ...state.dismissedProductIds],
      config,
      need: input.need,
      maxPriceMinor: input.maxPriceMinor,
      minPriceMinor: input.minPriceMinor,
      interests: profile?.interests ?? [],
      limit: input.limit,
    });
    const products = result.recommendations.map((entry) => entry.product);
    if (products.length > 0) {
      await recordSuggestions({
        storeId: session.storeId,
        sessionId: session.sessionId,
        visitorId: session.visitorId,
        trigger: `ai:${input.kind}`,
        anchorProductId: anchors[0] ?? null,
        productIds: products.map((product) => product.id),
        addOn: isAddOn && !input.customerAsked,
        source: result.recommendations[0]?.source,
      });
    }

    const label = input.kind === "recipe" && result.recipe ? `For your ${result.recipe}` : LABELS[input.kind];
    return success(
      {
        kind: input.kind,
        recipe: result.recipe ?? undefined,
        otherRecipes: result.recipeOptions && result.recipeOptions.length > 1 ? result.recipeOptions : undefined,
        products: result.recommendations.map((entry) => ({
          ...productCompact(entry.product),
          reason: entry.reason,
          ...(entry.compatibilityVerified === false ? { compatibilityVerified: false } : {}),
        })),
        note:
          products.length === 0
            ? "No suitable suggestions in the catalog. Don't invent any."
            : "Cards are on screen. Mention the top pick and its reason in a few words; never add facts the tool didn't give.",
      },
      products.length > 0 ? [{ type: "product_list", products, label }] : undefined,
    );
  },
};
