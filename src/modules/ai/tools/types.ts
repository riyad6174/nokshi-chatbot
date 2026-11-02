import type { z } from "zod";
import type { ChatPart } from "@/types/chat";
import type { SessionContext } from "@/modules/conversations/session.service";

export type ToolContext = {
  session: SessionContext;
  /** When the customer's current message arrived; confirm_order uses it to require a separate turn. */
  turnStartedAt?: Date;
  channel?: "text" | "voice";
  /** The customer's latest message, kept as evidence when they give marketing consent. */
  latestUserText?: string;
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
