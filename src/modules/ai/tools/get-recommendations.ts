import { z } from "zod";
import { recommendProducts } from "@/modules/catalog/recommendation.service";
import { getCartForTool, productCompact, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";

const schema = z.object({
  kind: z.enum(["similar", "cheaper", "complementary"]),
  productId: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(6).optional(),
});

const LABELS = {
  similar: "Similar picks",
  cheaper: "Budget-friendly options",
  complementary: "Goes well with your cart",
} as const;

export const getRecommendationsTool: ToolDefinition = {
  name: "get_recommendations",
  description:
    "Catalog-based suggestions around a product (or the cart when productId is omitted). kind: 'similar' (alternatives in the same category), 'cheaper' (lower-priced alternatives, for price objections), 'complementary' (an add-on that goes with it, to suggest after something is added to the cart). Shows product cards. Suggest at most one add-on per conversation step and never push after the customer declines.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["kind"],
    properties: {
      kind: { type: "string", enum: ["similar", "cheaper", "complementary"] },
      productId: { type: "string", description: "Product to base the suggestions on; defaults to the cart's items." },
      limit: { type: "integer", minimum: 1, maximum: 6, description: "Default 3." },
    },
  },
  schema,
  async execute(ctx, args) {
    const input = schema.parse(args);
    const cart = await getCartForTool(ctx);
    const cartProductIds = cart.items.map((item) => item.productId);
    const products = await recommendProducts({
      storeId: ctx.session.storeId,
      kind: input.kind,
      anchorProductIds: input.productId ? [input.productId] : cartProductIds,
      excludeProductIds: cartProductIds,
      recommendationMap: ctx.session.store.settings?.recommendationMap,
      limit: input.limit,
    });
    return success(
      {
        kind: input.kind,
        products: products.map(productCompact),
        note: products.length === 0 ? "No suitable suggestions in the catalog. Don't invent any." : undefined,
      },
      products.length > 0 ? [{ type: "product_list", products, label: LABELS[input.kind] }] : undefined,
    );
  },
};
