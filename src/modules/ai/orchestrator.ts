import { logger } from "@/lib/logging/logger";
import type { AiConfig } from "@/modules/ai/config";
import type { ProviderMessage, ProviderToolCall } from "@/modules/ai/provider";
import { streamCompletion } from "@/modules/ai/provider";
import { buildSystemPromptParts } from "@/modules/ai/system-instructions";
import { describeOpenProposal } from "@/modules/orders/voice-order.service";
import { savedDetailsForVisitor } from "@/modules/customers/profile.service";
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
  | { type: "done"; content: string; parts: ChatPart[]; missed?: boolean };

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
  const [openOrder, savedDetails] = await Promise.all([
    describeOpenProposal(input.session).catch(() => null),
    savedDetailsForVisitor(input.session.storeId, input.session.visitorId).catch(() => null),
  ]);
  const system = buildSystemPromptParts({
    openOrder,
    savedDetails,
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

  const builder = createPartBuilder();
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
      const result = await executeTool(toolContext, call.function.name, call.function.arguments);
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
  yield { type: "done", content: builder.text() || buildTextFromParts(parts), parts, missed };
}

function buildTextFromParts(parts: ChatPart[]): string {
  return parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}
