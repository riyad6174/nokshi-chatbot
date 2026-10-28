import type { z } from "zod";
import type { ChatPart } from "@/types/chat";
import type { SessionContext } from "@/modules/conversations/session.service";

export type ToolContext = {
  session: SessionContext;
};

export type ToolExecutionResult = {
  ok: boolean;
  content: unknown;
  ui?: ChatPart[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  schema: z.ZodTypeAny;
  execute: (ctx: ToolContext, args: unknown) => Promise<ToolExecutionResult>;
};
