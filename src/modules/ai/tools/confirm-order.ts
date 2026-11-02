import { z } from "zod";
import { priceLabel } from "@/lib/money";
import { failure, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";
import { CheckoutError } from "@/modules/commerce/checkout.service";
import { OrderError } from "@/modules/orders/order.service";
import { confirmProposedOrder } from "@/modules/orders/voice-order.service";

const schema = z.object({ confirmationId: z.string().trim().min(8).max(200).optional() });

export const confirmOrderTool: ToolDefinition = {
  name: "confirm_order",
  description:
    "Place the cash-on-delivery order from the order summary on screen. Call it IMMEDIATELY when the customer's latest message agrees in any way ('yes', 'ok', 'confirm', 'place it', 'হ্যাঁ', 'জি', 'ঠিক আছে', 'কনফার্ম'). Don't ask again and don't re-show the summary first. Not in the same turn as propose_order, and not if they ask for changes.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      confirmationId: { type: "string", description: "Optional: the confirmationId from propose_order. Defaults to the summary on screen." },
    },
  },
  schema,
  async execute(ctx, args) {
    const parsed = schema.safeParse(args);
    if (!parsed.success) return failure("invalid_arguments", "Call confirm_order with no arguments to confirm the summary on screen.");
    try {
      const order = await confirmProposedOrder({
        session: ctx.session,
        confirmationId: parsed.data.confirmationId,
        notBefore: ctx.turnStartedAt ?? new Date(),
      });
      return success({
        placed: true,
        orderNumber: order.orderNumber,
        total: priceLabel(order.totalMinor, order.currency),
        payment: "cash on delivery",
        note: "Placed. In one short sentence: thank them, give the order number, and say they pay on delivery.",
      });
    } catch (error) {
      if (error instanceof OrderError || error instanceof CheckoutError) return failure(error.code, error.message, error.details);
      throw error;
    }
  },
};
