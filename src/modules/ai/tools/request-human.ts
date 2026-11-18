import { z } from "zod";
import { failure, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";
import { requestHandoff, wantsHuman } from "@/modules/conversations/handoff.service";

// What a customer says when they really want a person, in English and Bangla.
const ASKS_FOR_PERSON =
  /(human|person|agent|staff|someone real|real person|representative|customer (care|service)|support team|talk to (someone|a person))|মানুষ|এজেন্ট|স্টাফ|কাস্টমার কেয়ার|কাস্টমার সার্ভিস|কারো সাথে কথা|কর্মী|প্রতিনিধি/i;

/** On a voice call the AI hands off only when the customer asked for a person themselves. */
function customerAskedForPerson(text: string, keywordsJson: string | null | undefined): boolean {
  return ASKS_FOR_PERSON.test(text) || wantsHuman(text, keywordsJson);
}

const schema = z.object({
  reason: z.string().trim().min(3).max(300),
});

export const requestHumanTool: ToolDefinition = {
  name: "request_human",
  description:
    // When to hand off is in the rules (it differs between chat and a voice call), not repeated here.
    "Hand the conversation to a human team member, when the rules say to. Then tell the customer briefly that a team member will reply here; don't keep troubleshooting.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["reason"],
    properties: {
      reason: { type: "string", description: "One sentence for the agent: what the customer needs." },
    },
  },
  schema,
  async execute(ctx, args) {
    const input = schema.parse(args);
    if (ctx.session.store.settings?.handoffEnabled === false) {
      return failure("handoff_disabled", "Human handoff is turned off. Offer the store's contact details from the knowledge base instead.");
    }
    // A live voice call stays with the assistant (a handoff moves the customer to text chat), unless
    // they asked for a person. Complaints and refunds still reach the team through the inbox.
    if (ctx.channel === "voice" && !customerAskedForPerson(ctx.latestUserText ?? "", ctx.session.store.settings?.handoffKeywords)) {
      return failure(
        "not_requested",
        "Don't hand off: the customer didn't ask for a person. Keep helping by voice. If you can't find something, say so in one sentence and offer what the store has.",
      );
    }
    await requestHandoff({ storeId: ctx.session.storeId, conversationId: ctx.session.conversationId, reason: input.reason });
    return success({ handedOff: true, note: "A human agent has been notified. Stop assisting and let them take over." });
  },
};
