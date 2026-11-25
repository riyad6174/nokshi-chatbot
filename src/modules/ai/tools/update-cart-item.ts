import { z } from "zod";
import { updateItem } from "@/modules/cart/cart.service";
import {
  cartCompact,
  cartErrorToResult,
  failure,
  requireActiveCart,
  resolveCartItemId,
  success,
} from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";

const schema = z.object({
  itemId: z.string().min(1).max(100).optional(),
  product: z.string().trim().min(1).max(200).optional(),
  variant: z.string().trim().min(1).max(100).optional(),
  quantity: z.number().int().min(1).max(99),
});

export const updateCartItemTool: ToolDefinition = {
  name: "update_cart_item",
  description: "Change the quantity of a cart line, by product name (or itemId).",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["quantity"],
    properties: {
      itemId: { type: "string", description: "Cart item id (from the cart), or give product instead." },
      product: { type: "string", description: "Product name in the cart, e.g. \"Urban Trek Backpack\"." },
      variant: { type: "string", description: "Version, if the same product is in the cart twice." },
      quantity: { type: "integer", minimum: 1, maximum: 99, description: "New total quantity for this line." },
    },
  },
  schema,
  async execute(ctx, args) {
    const input = schema.parse(args);
    try {
      const itemId = await resolveCartItemId(ctx, input);
      if (!itemId) return failure("item_not_found", "That item isn't in the cart. Check the cart (get_cart) and pass the product name as listed.");
      const cart = await requireActiveCart(ctx);
      const updated = await updateItem({
        sessionId: ctx.session.sessionId,
        storeId: ctx.session.storeId,
        cartId: cart.id,
        itemId,
        quantity: input.quantity,
      });
      return success(
        { message: "Quantity updated. Totals below are authoritative.", cart: cartCompact(updated) },
        [{ type: "cart_summary", cart: updated, label: "Cart updated" }],
      );
    } catch (error) {
      return cartErrorToResult(error);
    }
  },
};
