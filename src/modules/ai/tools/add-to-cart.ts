import { z } from "zod";
import { addItem } from "@/modules/cart/cart.service";
import { cartCompact, cartErrorToResult, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";

const schema = z.object({
  productId: z.string().min(1).max(100),
  variantId: z.string().min(1).max(100).nullish(),
  quantity: z.number().int().min(1).max(99).default(1),
});

export const addToCartTool: ToolDefinition = {
  name: "add_to_cart",
  description:
    "Add a product variant to the current session's cart. Use only product and variant ids from a successful search_products result. If the product has multiple variants, ask the customer which one they want.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["productId"],
    properties: {
      productId: { type: "string", description: "Product id from search_products." },
      variantId: { type: "string", description: "Variant id from search_products. Required when multiple variants exist." },
      quantity: { type: "integer", minimum: 1, maximum: 99, description: "Units to add (default 1)." },
    },
  },
  schema,
  async execute(ctx, args) {
    const input = schema.parse(args);
    try {
      const cart = await addItem({
        sessionId: ctx.session.sessionId,
        storeId: ctx.session.storeId,
        currency: ctx.session.store.currency,
        productId: input.productId,
        variantId: input.variantId ?? null,
        quantity: input.quantity,
      });
      return success(
        {
          message: "Item added to the cart. Totals below are authoritative.",
          cart: cartCompact(cart),
        },
        [{ type: "cart_summary", cart }],
      );
    } catch (error) {
      return cartErrorToResult(error);
    }
  },
};
