import { z } from "zod";
import { formatMinor } from "@/lib/money";
import { failure, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";
import { findOrdersForCustomer, toOrderStatusData } from "@/modules/orders/order.service";

const schema = z.object({
  orderNumber: z.string().trim().max(30).optional(),
  phone: z.string().trim().max(25).optional(),
});

export const getOrderStatusTool: ToolDefinition = {
  name: "get_order_status",
  description:
    "Look up order status. With no arguments, returns orders placed in this chat. For any other order, BOTH the order number (e.g. NB-7K2QX9) and the phone number used for the order are required; ask the customer for them. Never guess or reveal an order without a match.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      orderNumber: { type: "string", description: "Order number such as NB-7K2QX9." },
      phone: { type: "string", description: "Phone number the order was placed with." },
    },
  },
  schema,
  async execute(ctx, args) {
    const input = schema.parse(args);
    const { orders, verified } = await findOrdersForCustomer({
      storeId: ctx.session.storeId,
      sessionId: ctx.session.sessionId,
      orderNumber: input.orderNumber,
      phone: input.phone,
    });

    if (input.orderNumber && !verified) {
      return failure(
        "not_verified",
        input.phone
          ? "No order matches that order number and phone number."
          : "Ask for the phone number used for this order before sharing its status.",
      );
    }
    if (orders.length === 0) {
      return success({ orders: [], note: "No orders were placed in this chat. Ask for the order number and phone number." });
    }

    const data = orders.map(toOrderStatusData);
    return success(
      {
        orders: data.map((order) => ({
          orderNumber: order.orderNumber,
          status: order.statusLabel,
          placedAt: order.placedAt,
          total: formatMinor(order.totalMinor, order.currency),
          payment: order.paymentMethod === "cod" ? `cash on delivery (${order.paymentStatus})` : order.paymentStatus,
          trackingNumber: order.trackingNumber || null,
          items: order.items.map((item) => `${item.quantity} × ${item.name}${item.variantTitle ? ` (${item.variantTitle})` : ""}`),
        })),
      },
      [{ type: "order_status", orders: data }],
    );
  },
};
