import { z } from "zod";
import { cartCompact, getCartForTool, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";

const schema = z.object({});

export const getCartTool: ToolDefinition = {
  name: "get_cart",
  description: "Read the cart, with server-calculated totals.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  schema,
  parallelSafe: true,
  async execute(ctx) {
    const cart = await getCartForTool(ctx);
    return success({ cart: cartCompact(cart) }, [{ type: "cart_summary", cart, label: "Your cart" }]);
  },
};
