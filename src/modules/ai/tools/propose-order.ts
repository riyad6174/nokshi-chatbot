import { z } from "zod";
import { priceLabel } from "@/lib/money";
import { customerDetailsSchema } from "@/lib/validation/schemas";
import { failure, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";
import { CheckoutError } from "@/modules/commerce/checkout.service";
import { UntrustedCheckoutUrlError } from "@/modules/commerce/checkout-url";
import { OrderError, parseShippingZones } from "@/modules/orders/order.service";
import { deliveryAreas, proposeOrder } from "@/modules/orders/voice-order.service";
import { savedDetailsForVisitor, upsertProfile } from "@/modules/customers/profile.service";

// Everything is optional here: what the customer didn't say this time comes from their saved
// details, and whatever is still missing is reported back so the assistant asks only for that.
const argsSchema = z.object({
  name: z.string().trim().max(100).optional(),
  // Generous: a number said in words ("জিরো ওয়ান সেভেন…") is long until converted to digits.
  phone: z.string().trim().max(200).optional(),
  address: z.string().trim().max(400).optional(),
  city: z.string().trim().max(100).optional(),
  email: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
  deliveryAreaId: z.string().trim().max(50).optional(),
});

const detailsSchema = customerDetailsSchema.extend({
  email: z.string().trim().max(200).optional().default(""),
  city: z.string().trim().max(100).optional().default(""),
  notes: z.string().trim().max(500).optional().default(""),
});

const FIELD_LABELS: Record<string, string> = { name: "name", phone: "phone number", address: "delivery address" };

export const proposeOrderTool: ToolDefinition = {
  name: "propose_order",
  description:
    "Show the order summary card (cash on delivery) for the customer's single, final confirmation. Pass the details the customer gave in this conversation; anything you leave out is filled from their saved details. If something is still missing, the result lists it: ask for just that. Does NOT place the order: when they agree, call confirm_order.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", description: "Full name as the customer gave it (omit to use the saved one)." },
      phone: { type: "string", description: "Phone number as given, digits only (omit to use the saved one)." },
      address: { type: "string", description: "Delivery address (omit to use the saved one)." },
      city: { type: "string" },
      email: { type: "string" },
      notes: { type: "string", description: "Delivery notes, if any." },
      deliveryAreaId: { type: "string", description: "Delivery area id (see STORE delivery areas); omit to use the saved one." },
    },
  },
  schema: argsSchema,
  async execute(ctx, args) {
    const given = argsSchema.parse(args);
    const saved = await savedDetailsForVisitor(ctx.session.storeId, ctx.session.visitorId);
    const merged = {
      name: given.name || saved?.name || "",
      phone: given.phone || saved?.phone || "",
      address: given.address || saved?.address || "",
      city: given.city || saved?.city || "",
      email: given.email || "",
      notes: given.notes || "",
    };
    const zones = parseShippingZones(ctx.session.store.shippingZones);
    const savedZone = zones.some((zone) => zone.id === saved?.deliveryAreaId) ? saved!.deliveryAreaId : "";
    const deliveryAreaId = given.deliveryAreaId || savedZone || (zones.length === 1 ? zones[0]!.id : "");

    const parsed = detailsSchema.safeParse(merged);
    if (!parsed.success) {
      const missing = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
      return failure("missing_details", `Ask only for: ${missing.map((field) => FIELD_LABELS[field] ?? field).join(", ")}.`, {
        missing,
        alreadyHave: Object.fromEntries(Object.entries(merged).filter(([key, value]) => value && !missing.includes(key))),
      });
    }

    try {
      const confirmation = await proposeOrder({ session: ctx.session, customer: parsed.data, shippingZoneId: deliveryAreaId });
      await upsertProfile(
        { storeId: ctx.session.storeId, visitorId: ctx.session.visitorId },
        {
          name: parsed.data.name,
          phone: parsed.data.phone,
          email: parsed.data.email || undefined,
          address: parsed.data.address,
          city: parsed.data.city || undefined,
          deliveryAreaId: deliveryAreaId || undefined,
          preferredLocale: ctx.session.locale,
        },
      );
      return success(
        {
          confirmationId: confirmation.confirmationId,
          itemCount: confirmation.lines.reduce((sum, line) => sum + line.quantity, 0),
          total: priceLabel(confirmation.totalMinor, confirmation.currency),
          deliveryArea: confirmation.deliveryArea,
          payment: "cash on delivery",
          note: "Summary card on screen with all details (editable there), NOT placed yet. In one short sentence give the total and ask them to confirm. Don't read the details back. When they agree, call confirm_order right away.",
        },
        [{ type: "order_confirmation", confirmation }],
      );
    } catch (error) {
      if (error instanceof OrderError && error.code === "invalid_zone") {
        return failure("delivery_area_required", "Ask which delivery area the address is in.", {
          deliveryAreas: deliveryAreas(ctx.session.store),
        });
      }
      if (error instanceof OrderError || error instanceof CheckoutError) return failure(error.code, error.message, error.details);
      if (error instanceof UntrustedCheckoutUrlError) return failure("checkout_failed", "The order could not be prepared.");
      throw error;
    }
  },
};
