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
  /** The customer's last few messages, newest first (live voice: a request isn't lost behind a stray line). */
  recentUserTexts?: string[];
  /**
   * Cards already shown during the reply being generated (not saved yet), so "number 2" or "open its
   * page" right after a search in the same turn finds what's on screen.
   */
  shownThisTurn?: ChatPart[];
  /** The customer said yes right after the assistant offered to connect them with a person. */
  acceptedPersonOffer?: boolean;
  /** Context for cost-saving caches: never reuse a canned answer mid-cart or mid-order. */
  cartItemCount?: number;
  openOrder?: boolean;
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
  /**
   * Only reads (event logging aside), so several calls in one model round can run at the same time.
   * Leave unset for anything that changes the cart, order, profile or session state.
   */
  parallelSafe?: boolean;
  execute: (ctx: ToolContext, args: unknown) => Promise<ToolExecutionResult>;
};
