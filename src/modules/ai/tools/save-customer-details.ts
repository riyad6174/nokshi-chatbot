import { z } from "zod";
import { customerDetailsSchema } from "@/lib/validation/schemas";
import { failure, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";
import { CheckoutError, prepareCheckoutForSession, saveCheckoutCustomer } from "@/modules/commerce/checkout.service";
import { UntrustedCheckoutUrlError } from "@/modules/commerce/checkout-url";

const schema = customerDetailsSchema.extend({
  email: z.string().trim().max(200).optional().default(""),
  city: z.string().trim().max(100).optional().default(""),
  notes: z.string().trim().max(500).optional().default(""),
});

export const saveCustomerDetailsTool: ToolDefinition = {
  name: "save_customer_details",
  description:
    "Save the delivery details the customer typed in chat (name, phone, address) and prepare checkout with the current cart. Only call after the customer confirmed the cart and gave these details themselves; never guess them. This does NOT place the order: the customer reviews and places it on the checkout page by tapping the checkout button.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["name", "phone", "address"],
    properties: {
      name: { type: "string", description: "Customer's full name as they wrote it." },
      phone: { type: "string", description: "Phone number as written." },
      address: { type: "string", description: "Delivery address." },
      city: { type: "string" },
      email: { type: "string" },
      notes: { type: "string", description: "Delivery notes, if any." },
    },
  },
  schema,
  async execute(ctx, args) {
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      return failure(
        "invalid_details",
        "Some details are missing or invalid. Ask the customer for them.",
        parsed.error.issues.map((issue) => ({ field: issue.path.join("."), problem: issue.message })),
      );
    }
    try {
      const prepared = await prepareCheckoutForSession({ sessionId: ctx.session.sessionId, store: ctx.session.store });
      await saveCheckoutCustomer(prepared.checkoutSessionId, parsed.data);
      return success(
        {
          saved: true,
          note: "Details saved and the cart validated. Tell the customer to tap the checkout button to review, choose delivery area and payment, and place the order. The order is NOT placed yet.",
        },
        [{ type: "checkout_action" }],
      );
    } catch (error) {
      if (error instanceof CheckoutError) return failure(error.code, error.message, error.details);
      if (error instanceof UntrustedCheckoutUrlError) return failure("checkout_failed", "Checkout could not be prepared.");
      throw error;
    }
  },
};
