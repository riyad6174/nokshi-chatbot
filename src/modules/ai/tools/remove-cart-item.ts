import { z } from "zod";
import { removeItem } from "@/modules/cart/cart.service";
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
});

export const removeCartItemTool: ToolDefinition = {
  name: "remove_cart_item",
  description: "Remove one line from the cart, by product name (or itemId).",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      itemId: { type: "string", description: "Cart item id (from the cart), or give product instead." },
      product: { type: "string", description: "Product name in the cart, e.g. \"Urban Trek Backpack\"." },
      variant: { type: "string", description: "Version, if the same product is in the cart twice." },
    },
  },
  schema,
  async execute(ctx, args) {
    const input = schema.parse(args);
    try {
      const itemId = await resolveCartItemId(ctx, input);
      if (!itemId) return failure("item_not_found", "That item isn't in the cart. Check the cart (get_cart) and pass the product name as listed.");
      const cart = await requireActiveCart(ctx);
      const updated = await removeItem({
        sessionId: ctx.session.sessionId,
        storeId: ctx.session.storeId,
        cartId: cart.id,
        itemId,
      });
      return success(
        { message: "Item removed. Totals below are authoritative.", cart: cartCompact(updated) },
        [{ type: "cart_summary", cart: updated, label: "Removed from cart" }],
      );
    } catch (error) {
      return cartErrorToResult(error);
    }
  },
};
