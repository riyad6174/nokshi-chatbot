import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getActiveCart } from "@/modules/cart/cart.service";
import { buildSummary } from "@/modules/cart/cart.service";
import { cartCompact, failure, success } from "@/modules/ai/tools/helpers";
import { createInternalCommerceAdapter } from "@/modules/commerce/internal.adapter";
import type { ToolDefinition } from "@/modules/ai/tools/types";

const schema = z.object({});

export const prepareCheckoutTool: ToolDefinition = {
  name: "prepare_checkout",
  description:
    "Validate the cart for checkout (stock, prices) and show the customer a delivery-details form in the chat. Call when the customer wants to order or check out. This does NOT place an order.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  schema,
  async execute(ctx) {
    const cart = await getActiveCart(ctx.session.sessionId, ctx.session.storeId);
    if (!cart || cart.items.length === 0) {
      return failure("cart_empty", "The cart is empty, so there is nothing to check out.");
    }

    const lines = cart.items.map((item) => ({
      productId: item.productId,
      variantId: item.productVariantId,
      quantity: item.quantity,
    }));
    const adapter = createInternalCommerceAdapter(ctx.session.store);
    const validation = await adapter.validateLines(lines);
    const summary = buildSummary(cart);

    if (!validation.valid) {
      return success(
        {
          ready: false,
          issues: validation.issues,
          cart: cartCompact(summary),
          note: "Some items changed. Explain the issue and ask the customer to update the cart.",
        },
        [{ type: "cart_summary", cart: summary }],
      );
    }

    // Pre-fill from details this chat already collected (an earlier checkout or order), if any.
    const previous = await prisma.checkoutSession.findFirst({
      where: { storeId: ctx.session.storeId, cart: { sessionId: ctx.session.sessionId }, customer: { isSet: true } },
      orderBy: { createdAt: "desc" },
      select: { customer: true },
    });

    return success(
      {
        ready: true,
        cart: cartCompact(summary),
        note: "Cart validated. A delivery-details form is shown in the chat. Ask the customer to confirm and fill it in (or type name, phone and address, then call save_customer_details). The order is placed on the checkout page, never in chat.",
      },
      [
        { type: "cart_summary", cart: summary },
        { type: "details_form", prefill: previous?.customer ?? {} },
      ],
    );
  },
};
