import { z } from "zod";
import { getProductById } from "@/modules/catalog/product.service";
import { failure, productCompact, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";

const schema = z.object({
  productId: z.string().min(1).max(100),
});

export const getProductDetailsTool: ToolDefinition = {
  name: "get_product_details",
  description:
    "Fetch the current facts for one product in the current store, including description, price, and variants. Use the product id returned by search_products.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["productId"],
    properties: {
      productId: { type: "string", description: "The internal product id from a previous tool result." },
    },
  },
  schema,
  async execute(ctx, args) {
    const input = schema.parse(args);
    const product = await getProductById(ctx.session.storeId, input.productId);
    if (!product) {
      return failure("product_not_found", "That product is not available in this store.");
    }
    return success({ product: productCompact(product) }, [{ type: "product_list", products: [product] }]);
  },
};
