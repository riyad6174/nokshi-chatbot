import { z } from "zod";
import { isBdMobile, spokenPhone } from "@/lib/digits";
import { prisma } from "@/lib/db/prisma";
import { failure, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";
import { deliveryAreas } from "@/modules/orders/voice-order.service";

const schema = z.object({
  name: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(400).optional(),
  city: z.string().trim().max(100).optional(),
  deliveryAreaId: z.string().trim().max(50).optional(),
  reason: z.string().trim().max(200).optional(),
});

export const collectContactDetailsTool: ToolDefinition = {
  name: "collect_contact_details",
  description:
    "Show an editable form for name, phone, delivery address and delivery area, prefilled with what you understood. Use it instead of asking again whenever a detail heard by voice is unclear: a phone number that isn't a clear 11-digit mobile number starting with 01, a name or address you're unsure of, or after the customer corrected something once. The customer fixes it and sends it; their message then contains the exact details.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", description: "What you heard, if anything." },
      phone: { type: "string", description: "What you heard, if anything (digits)." },
      address: { type: "string" },
      city: { type: "string" },
      deliveryAreaId: { type: "string" },
      reason: { type: "string", description: "Short note shown on the form, e.g. 'Please check your phone number'." },
    },
  },
  schema,
  async execute(ctx, args) {
    const input = schema.parse(args);
    if (input.phone && isBdMobile(input.phone) && input.name) {
      return failure(
        "details_fine",
        `The phone number ${spokenPhone(input.phone)} is valid and the name is fine, so no form is needed. ${
          input.address ? "Call propose_order now." : "Ask for the delivery address."
        }`,
      );
    }
    // Never loop on the form: if it was just shown and the customer answered without sending it
    // ("ok", "that's right"), carry on with what was heard.
    const recent = await prisma.message.findMany({
      where: { conversationId: ctx.session.conversationId, role: { in: ["user", "assistant"] } },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { role: true, structuredContent: true },
    });
    const lastAssistant = recent.find((message) => message.role === "assistant");
    if (lastAssistant?.structuredContent?.includes('"contact_form"')) {
      return failure(
        "form_already_shown",
        "The form was already shown and the customer replied without changing it, so the details you heard are fine. Don't mention the form again: continue with propose_order using those details (or ask only for a detail you don't have yet, e.g. the address).",
      );
    }
    return success(
      { shown: true, note: "Form on screen. Say in one short sentence that they can check and send it. Wait for their message." },
      [
        {
          type: "contact_form",
          prefill: {
            name: input.name ?? "",
            phone: input.phone ? spokenPhone(input.phone) : "",
            address: input.address ?? "",
            city: input.city ?? "",
          },
          deliveryAreas: deliveryAreas(ctx.session.store).map((area) => ({ id: area.id, label: area.label })),
          deliveryAreaId: input.deliveryAreaId ?? "",
          note: input.reason ?? "",
        },
      ],
    );
  },
};
