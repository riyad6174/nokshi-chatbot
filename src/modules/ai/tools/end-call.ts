import { z } from "zod";
import { success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";

/**
 * Ends a live voice call once the customer is done ("না, ধন্যবাদ", "that's all", "bye"). Only offered
 * on live calls: the browser hangs up after the goodbye has been spoken, so the call never cuts off
 * mid-sentence or while the customer still wants something.
 */
export const endCallTool: ToolDefinition = {
  name: "end_call",
  description:
    "End the voice call when the customer is done: they said no to \"anything else?\", said bye/thanks/that's all, or asked to hang up. Never call it while they still want something.",
  parameters: { type: "object", additionalProperties: false, properties: {} },
  schema: z.object({}),
  async execute() {
    return success({
      ending: true,
      note: 'Now say one short, warm goodbye in their language (e.g. "ধন্যবাদ, ভালো থাকবেন!" / "Thanks, have a great day!"). The call ends right after you finish speaking.',
    });
  },
};
