import { z } from "zod";
import { failure, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";
import { requestHandoff } from "@/modules/conversations/handoff.service";

const schema = z.object({
  reason: z.string().trim().min(3).max(300),
});

export const requestHumanTool: ToolDefinition = {
  name: "request_human",
  description:
    "Hand the conversation to a human team member. Use when the customer asks for a person, when they're upset, for complaints, damaged/wrong items, refunds needing approval, or anything you can't answer from the tools. After calling, tell the customer briefly that a team member will reply here; don't keep troubleshooting.",
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
    await requestHandoff({ storeId: ctx.session.storeId, conversationId: ctx.session.conversationId, reason: input.reason });
    return success({ handedOff: true, note: "A human agent has been notified. Stop assisting and let them take over." });
  },
};
