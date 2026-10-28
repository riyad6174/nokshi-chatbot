import { z } from "zod";
import { cartCompact, getCartForTool, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";

const schema = z.object({});

export const getCartTool: ToolDefinition = {
  name: "get_cart",
  description: "Read the current session's cart. The server calculates prices and totals; never calculate them yourself.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  schema,
  async execute(ctx) {
    const cart = await getCartForTool(ctx);
    return success({ cart: cartCompact(cart) }, [{ type: "cart_summary", cart }]);
  },
};
