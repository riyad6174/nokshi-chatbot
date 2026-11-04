import { logger } from "@/lib/logging/logger";
import type { AiConfig } from "@/modules/ai/config";
import type { MessageAttachment } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { ProviderMessage, ProviderToolCall } from "@/modules/ai/provider";
import { ProviderError, streamCompletion } from "@/modules/ai/provider";
import { attachmentUnderstandingEnabled, loadAttachmentParts } from "@/modules/ai/attachments";
import { resolveSalesConfig, type SalesConfig } from "@/modules/sales/config";
import { detectShoppingIntent } from "@/modules/sales/intent";
import { buildSalesTurnContext } from "@/modules/sales/prompt";
import { getEngagementState, isOptedOut, type EngagementState } from "@/modules/sales/state";
import { buildSystemPromptParts } from "@/modules/ai/system-instructions";
import { describeOpenProposal } from "@/modules/orders/voice-order.service";
import { findProfileForVisitor, savedDetailsForVisitor } from "@/modules/customers/profile.service";
import { detectLang } from "@/modules/speech/speech-provider";
import { executeTool, getProviderTools } from "@/modules/ai/tools";
import type { ToolContext } from "@/modules/ai/tools/types";
import type { SessionContext } from "@/modules/conversations/session.service";
import type { TurnChannel } from "@/modules/conversations/turn.service";
import type { CartPayload, ChatPart } from "@/types/chat";

export type OrchestratorEvent =
  | { type: "delta"; text: string }
  | { type: "ui"; part: ChatPart }
  /** `missed`: the turn ended without a real answer (fallback text or refusal); repeated misses trigger handoff. */
  | { type: "done"; content: string; parts: ChatPart[]; missed?: boolean; toolLog?: ToolLogEntry[] };

/** One tool call in a turn, for reliability reporting. */
export type ToolLogEntry = { name: string; ok: boolean; code: string; ms: number };

export type AssistantHistoryMessage = { role: "user" | "assistant"; content: string };

/** Rounds in which the model may call tools. One more round follows, if needed, to reply in text. */
const MAX_TOOL_ITERATIONS = 5;

type PartBuilder = {
  text: () => string;
  currentText: () => string;
  appendText: (text: string) => void;
  addUi: (part: ChatPart) => void;
  finish: () => ChatPart[];
};

function createPartBuilder(): PartBuilder {
  const parts: ChatPart[] = [];
  let buffer = "";

  const closeText = () => {
    if (buffer.trim().length > 0) {
      parts.push({ type: "text", text: buffer });
    }
    buffer = "";
  };

  return {
    text: () => {
      closeText();
      return parts
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("\n\n")
        .trim();
    },
    currentText: () => buffer,
    appendText: (text) => {
      buffer += text;
    },
    addUi: (part) => {
      closeText();
      parts.push(part);
    },
    finish: () => {
      closeText();
      return [...parts];
    },
  };
}

function fallbackText(storeFallback: string | null | undefined): string {
  return (
    storeFallback?.trim() ||
    "I could not complete that request. Please try again, or contact support@nokshibazaar.example."
  );
}

export async function* runLiveAssistant(input: {
  session: SessionContext;
  cart: CartPayload;
  history: AssistantHistoryMessage[];
  config: AiConfig;
  channel?: TurnChannel;
  signal?: AbortSignal;
  /** Summary of messages older than the history window. */
  conversationSummary?: string;
  /** Files attached to the customer's current message, shown to the model when enabled. */
  attachments?: MessageAttachment[];
}): AsyncGenerator<OrchestratorEvent> {
  const latestUserText = [...input.history].reverse().find((message) => message.role === "user")?.content ?? "";
  const toolContext: ToolContext = {
    session: input.session,
    turnStartedAt: new Date(),
    channel: input.channel ?? "text",
    latestUserText,
  };
  const tools = getProviderTools();
  const settings = input.session.store.settings;
  const salesConfig = resolveSalesConfig(settings);
  const [openOrder, savedDetails, engagement] = await Promise.all([
    describeOpenProposal(input.session).catch(() => null),
    savedDetailsForVisitor(input.session.storeId, input.session.visitorId).catch(() => null),
    getEngagementState(input.session.sessionId).catch(() => null),
  ]);
  const salesTurn = engagement
    ? await salesTurnContext({ session: input.session, config: salesConfig, state: engagement, cart: input.cart, latestUserText, openOrder: Boolean(openOrder) }).catch(() => "")
    : "";
  const attachmentParts =
    input.attachments?.length && attachmentUnderstandingEnabled(salesConfig.features.attachmentUnderstanding)
      ? await loadAttachmentParts({
          storeId: input.session.storeId,
          conversationId: input.session.conversationId,
          attachments: input.attachments,
          config: input.config,
        }).catch((error) => {
          logger.warn("ai.attachments_failed", { error: error instanceof Error ? error.message : String(error) });
          return [];
        })
      : [];
  const system = buildSystemPromptParts({
    openOrder,
    savedDetails,
    salesTurn,
    conversationSummary: input.conversationSummary,
    replyLanguage: detectLang(latestUserText, input.session.locale.startsWith("bn") ? "bn" : "en"),
    session: input.session,
    cart: input.cart,
    configuredInstructions: settings?.systemInstructions,
    enabledFeatures: settings?.enabledFeatures,
    channel: input.channel ?? "text",
  });

  const messages: ProviderMessage[] = [
    { role: "system", content: system.stable, cache: true },
    { role: "system", content: system.perTurn },
    ...input.history.map((message) => ({ role: message.role, content: message.content })),
  ];
  // The customer's files go with their latest message (only that one: earlier files stay as notes).
  const lastIndex = messages.length - 1;
  const lastMessage = messages[lastIndex];
  const lastUserText = lastMessage?.role === "user" && typeof lastMessage.content === "string" ? lastMessage.content : null;
  let withAttachments = false;
  if (attachmentParts.length > 0 && lastUserText !== null) {
    messages[lastIndex] = { role: "user", content: [{ type: "text", text: lastUserText || "(no text)" }, ...attachmentParts] };
    withAttachments = true;
  }

  const builder = createPartBuilder();
  const toolLog: ToolLogEntry[] = [];
  let receivedAnyText = false;
  let turnRefused = false;

  for (let iteration = 0; iteration <= MAX_TOOL_ITERATIONS; iteration += 1) {
    // Out of tool rounds: one last call with tools disabled, so the model answers from the results it
    // already has instead of the turn ending on cards with no reply (which would count as a miss).
    const finalRound = iteration === MAX_TOOL_ITERATIONS;
    let iterationText = "";
    let toolCalls: ProviderToolCall[] = [];
    let raw: unknown;
    let refused = false;

    try {
      for await (const event of streamCompletion({
        config: input.config,
        messages,
        tools,
        signal: input.signal,
        temperature: 0.2,
        toolChoice: finalRound ? "none" : "auto",
      })) {
        if (event.type === "delta") {
          iterationText += event.text;
          builder.appendText(event.text);
          receivedAnyText = receivedAnyText || event.text.trim().length > 0;
          yield { type: "delta", text: event.text };
        } else {
          toolCalls = event.toolCalls;
          raw = event.raw;
          refused = event.finishReason === "refusal";
        }
      }
    } catch (error) {
      // A model that can't take images/PDFs rejects the request: answer from text instead of failing.
      const status = error instanceof ProviderError ? error.status : undefined;
      if (withAttachments && !iterationText && status != null && [400, 413, 415, 422].includes(status)) {
        logger.warn("ai.attachments_rejected", { storeId: input.session.storeId, status });
        withAttachments = false;
        messages[lastIndex] = {
          role: "user",
          content: `${lastUserText}\n[The customer attached a file, but this AI model can't read files. Say so in a few words and ask them to describe it.]`,
        };
        iteration -= 1;
        continue;
      }
      throw error;
    }

    if (refused) {
      logger.warn("ai.turn_refused", { storeId: input.session.storeId });
      turnRefused = true;
      break;
    }

    if (toolCalls.length === 0) {
      break;
    }
    if (finalRound) {
      // A provider that ignores tool_choice "none": don't run more tools.
      logger.warn("ai.tool_limit_reached", { storeId: input.session.storeId });
      break;
    }

    messages.push({
      role: "assistant",
      content: iterationText || null,
      tool_calls: toolCalls,
      raw,
    });

    for (const call of toolCalls) {
      const toolStarted = Date.now();
      const result = await executeTool(toolContext, call.function.name, call.function.arguments);
      toolLog.push({
        name: call.function.name,
        ok: result.ok,
        code: result.ok ? "" : String((result.content as { error?: { code?: string } })?.error?.code ?? "error"),
        ms: Date.now() - toolStarted,
      });
      if (!result.ok) {
        logger.warn("ai.tool_rejected", {
          tool: call.function.name,
          error: (result.content as { error?: { code?: string } })?.error?.code,
        });
      }
      const serialized = JSON.stringify(result.content);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        isError: !result.ok,
        content: serialized.length > 12_000 ? `${serialized.slice(0, 12_000)}...` : serialized,
      });

      for (const part of result.ui ?? []) {
        builder.addUi(part);
        yield { type: "ui", part };
      }
    }
  }

  const missed = turnRefused || (!receivedAnyText && builder.text().length === 0);
  if (missed) {
    const text = `${builder.currentText().trim() ? "\n\n" : ""}${fallbackText(settings?.fallbackMessage)}`;
    builder.appendText(text);
    yield { type: "delta", text };
  }

  const parts = builder.finish();
  yield { type: "done", content: builder.text() || buildTextFromParts(parts), parts, missed, toolLog };
}

async function salesTurnContext(input: {
  session: SessionContext;
  config: SalesConfig;
  state: EngagementState;
  cart: CartPayload;
  latestUserText: string;
  openOrder: boolean;
}): Promise<string> {
  if (!input.config.enabled) return "";
  const intent = detectShoppingIntent({ text: input.latestUserText, cartItemCount: input.cart.itemCount, openOrder: input.openOrder });
  const recentIds = input.state.suggestedProductIds.slice(-8);
  const [optedOut, suggested, profile] = await Promise.all([
    isOptedOut({ storeId: input.session.storeId, visitorId: input.session.visitorId, state: input.state }),
    recentIds.length
      ? prisma.product.findMany({ where: { id: { in: recentIds }, storeId: input.session.storeId }, select: { name: true } })
      : Promise.resolve([]),
    findProfileForVisitor(input.session.storeId, input.session.visitorId).catch(() => null),
  ]);
  return buildSalesTurnContext({
    config: input.config,
    intent,
    state: input.state,
    optedOut,
    cart: input.cart,
    suggestedNames: suggested.map((product) => product.name),
    returning: profile ? { orders: profile.orderCount, interests: profile.interests } : null,
  });
}

function buildTextFromParts(parts: ChatPart[]): string {
  return parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}
