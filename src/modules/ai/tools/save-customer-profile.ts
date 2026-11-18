import { z } from "zod";
import { spokenPhone } from "@/lib/digits";
import { failure, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";
import { CONSENT_QUESTION, upsertProfile } from "@/modules/customers/profile.service";

const schema = z.object({
  name: z.string().trim().max(100).optional(),
  phone: z
    .preprocess(
      (value) => (typeof value === "string" ? spokenPhone(value) : value),
      z
        .string()
        .trim()
        .max(25)
        .refine((value) => value.replace(/\D/g, "").length >= 8, "Phone number looks incomplete"),
    )
    .optional(),
  email: z.string().trim().email().max(200).optional(),
  address: z.string().trim().max(400).optional(),
  city: z.string().trim().max(100).optional(),
  deliveryAreaId: z.string().trim().max(50).optional(),
  interests: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  budget: z.string().trim().max(100).optional(),
  marketingConsent: z
    .object({
      granted: z.boolean(),
      channels: z.array(z.enum(["sms", "whatsapp", "email"])).max(3).default([]),
    })
    .optional(),
});

export const saveCustomerProfileTool: ToolDefinition = {
  name: "save_customer_profile",
  // Kept under the 420-character limit in getProviderTools, so the consent rule is never cut off.
  description: `Silently save what the customer said, the moment they say it (only what they actually said): contact details, interests, budget. marketingConsent: ONLY when your previous message asked exactly "${CONSENT_QUESTION}" and their latest message clearly answers it (true with the channels for yes, false for no). Never assume consent.`,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      phone: { type: "string" },
      email: { type: "string" },
      address: { type: "string", description: "Delivery address as given." },
      city: { type: "string" },
      deliveryAreaId: { type: "string" },
      interests: { type: "array", items: { type: "string" }, description: "e.g. [\"travel backpacks\", \"black\"]" },
      budget: { type: "string", description: "As said, e.g. \"under 3000 taka\"." },
      marketingConsent: {
        type: "object",
        additionalProperties: false,
        required: ["granted"],
        properties: {
          granted: { type: "boolean" },
          channels: { type: "array", items: { type: "string", enum: ["sms", "whatsapp", "email"] } },
        },
      },
    },
  },
  schema,
  async execute(ctx, args) {
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      return failure(
        "invalid_details",
        "Some details were not valid; save only what the customer clearly said.",
        parsed.error.issues.map((issue) => ({ field: issue.path.join("."), problem: issue.message })),
      );
    }
    const { budget, marketingConsent, ...patch } = parsed.data;
    const consent = marketingConsent
      ? {
          granted: marketingConsent.granted,
          channels: marketingConsent.channels.length > 0 ? marketingConsent.channels : ["sms", "whatsapp", "email"],
          source: ctx.channel === "voice" ? ("voice" as const) : ("chat" as const),
          evidence: ctx.latestUserText ?? "",
        }
      : undefined;
    await upsertProfile(
      { storeId: ctx.session.storeId, visitorId: ctx.session.visitorId },
      { ...patch, budgetHint: budget, preferredLocale: ctx.session.locale },
      consent,
    );
    return success({
      saved: true,
      ...(consent ? { marketingConsent: consent.granted ? "granted" : "declined" } : {}),
    });
  },
};
