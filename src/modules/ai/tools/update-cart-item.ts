import { z } from "zod";
import { updateItem } from "@/modules/cart/cart.service";
import {
  cartCompact,
  cartErrorToResult,
  requireActiveCart,
  success,
} from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";

const schema = z.object({
  itemId: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(99),
});

export const updateCartItemTool: ToolDefinition = {
  name: "update_cart_item",
  description: "Change the quantity of a cart item using its itemId from get_cart.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["itemId", "quantity"],
    properties: {
      itemId: { type: "string", description: "Cart item id from get_cart." },
      quantity: { type: "integer", minimum: 1, maximum: 99, description: "New total quantity for this line." },
    },
  },
  schema,
  async execute(ctx, args) {
    const input = schema.parse(args);
    try {
      const cart = await requireActiveCart(ctx);
      const updated = await updateItem({
        sessionId: ctx.session.sessionId,
        storeId: ctx.session.storeId,
        cartId: cart.id,
        itemId: input.itemId,
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
