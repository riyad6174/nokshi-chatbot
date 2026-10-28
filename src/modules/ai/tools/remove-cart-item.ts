import { z } from "zod";
import { removeItem } from "@/modules/cart/cart.service";
import {
  cartCompact,
  cartErrorToResult,
  requireActiveCart,
  success,
} from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";

const schema = z.object({
  itemId: z.string().min(1).max(100),
});

export const removeCartItemTool: ToolDefinition = {
  name: "remove_cart_item",
  description: "Remove one line from the current session's cart using its itemId from get_cart.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["itemId"],
    properties: {
      itemId: { type: "string", description: "Cart item id from get_cart." },
    },
  },
  schema,
  async execute(ctx, args) {
    const input = schema.parse(args);
    try {
      const cart = await requireActiveCart(ctx);
      const updated = await removeItem({
        sessionId: ctx.session.sessionId,
        storeId: ctx.session.storeId,
        cartId: cart.id,
        itemId: input.itemId,
      });
      return success(
        { message: "Item removed. Totals below are authoritative.", cart: cartCompact(updated) },
        [{ type: "cart_summary", cart: updated }],
      );
    } catch (error) {
      return cartErrorToResult(error);
    }
  },
};
