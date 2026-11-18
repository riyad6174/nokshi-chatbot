import { randomUUID } from "node:crypto";
import type { Conversation, MessageAttachment } from "@prisma/client";
import { logger } from "@/lib/logging/logger";
import { prisma } from "@/lib/db/prisma";
import {
  appendMessage,
  buildProviderHistory,
  conversationMode,
  getProviderHistoryRows,
  listConversationMessages,
} from "@/modules/conversations/conversation.service";
import { recordTurnOutcome, requestHandoff, wantsHuman } from "@/modules/conversations/handoff.service";
import type { SessionContext } from "@/modules/conversations/session.service";
import { getCartSummary } from "@/modules/cart/cart.service";
import { isLiveAiEnabled, runAssistant } from "@/modules/ai/run";
import { resolveAiConfig } from "@/modules/ai/config";
import type { ToolLogEntry } from "@/modules/ai/orchestrator";
import { recordAiTurn } from "@/modules/analytics/turn-log.service";
import { recordUsage } from "@/modules/analytics/usage.service";
import { addUsage, emptyUsage } from "@/modules/ai/usage";
import { summarizeBeforeCutoff } from "@/modules/conversations/summary.service";
import { capturePhoneFromSpeech } from "@/modules/customers/profile.service";
import { trackEvent } from "@/modules/customers/events.service";
import { captureUnansweredQuestion } from "@/modules/knowledge/learning.service";
import { detectShoppingIntent } from "@/modules/sales/intent";
import { getEngagementState, isOptedOut, setSuggestionOptOut } from "@/modules/sales/state";
import type { ChatPart } from "@/types/chat";

export type TurnChannel = "text" | "voice";
export type TurnSend = (event: string, data: unknown) => void;

/**
 * One customer turn after their message is stored: human-handoff checks, the AI reply (text deltas
 * and UI parts), persistence and miss tracking. Shared by the text and voice endpoints, which only
 * differ in how the customer's words arrive and how the reply is delivered.
 *
 * SSE events sent: message.delta {text} · message.status {tool} · ui.part {part} · ui.cart {cart} · message.event {message}
 * · conversation.mode {mode} · message.completed {messageId} · message.error {message, retryable}
 */
export async function runConversationTurn(input: {
  context: SessionContext;
  conversation: Pick<Conversation, "id" | "status">;
  userText: string;
  attachments: MessageAttachment[];
  channel: TurnChannel;
  signal: AbortSignal;
  send: TurnSend;
  /** When the request arrived (Date.now()), so reported latency includes loading, not just the AI. */
  requestStartedAt?: number;
}): Promise<void> {
  const { context, conversation, userText, attachments, send } = input;
  const settings = context.store.settings;
  const handoffOptions = {
    storeId: context.storeId,
    conversationId: conversation.id,
    handoffEnabled: settings?.handoffEnabled !== false,
    handoffAfterMisses: settings?.handoffAfterMisses ?? 2,
  };

  // Reliability record of this turn (written once it ends, whatever the outcome).
  let turnLog: (Omit<Parameters<typeof recordAiTurn>[0], "outcome" | "latencyMs"> & { started: number }) | null = null;
  const usageTurnId = randomUUID();
  let turnUsage = emptyUsage();
  let usageEventCount = 0;
  let costMicros = 0;
  let pricedEventCount = 0;
  let unpricedEventCount = 0;
  const usageLogFields = () =>
    usageEventCount === 0
      ? {}
      : {
          usage: turnUsage,
          costMicros,
          pricingStatus: (unpricedEventCount === 0
            ? "priced"
            : pricedEventCount === 0
              ? "unpriced"
              : "mixed") as "priced" | "unpriced" | "mixed",
          usageEventCount,
        };

  // What the assistant said and showed so far, so a reply the customer talks over is still remembered.
  let partialText = "";
  const partialParts: ChatPart[] = [];
  let persisted = false;
  const persistInterrupted = async () => {
    if (persisted || (!partialText.trim() && partialParts.length === 0)) return;
    persisted = true;
    const content = `${partialText.trim()} (interrupted)`.trim();
    await appendMessage({
      conversationId: conversation.id,
      role: "assistant",
      content,
      parts: [...(partialText.trim() ? [{ type: "text" as const, text: `${partialText.trim()} …` }] : []), ...partialParts],
    }).catch(() => undefined);
  };

  const sendModeAndEvents = async (since: Date) => {
    const current = await prisma.conversation.findUnique({ where: { id: conversation.id }, select: { status: true } });
    const events = await listConversationMessages(conversation.id, { after: since });
    for (const message of events.filter((entry) => entry.role === "event")) send("message.event", { message });
    send("conversation.mode", { mode: conversationMode(current?.status ?? "bot") });
  };

  try {
    // A human is handling this chat: store the message, don't let the AI answer over them.
    if (conversation.status === "waiting_human" || conversation.status === "human") {
      send("conversation.mode", { mode: conversationMode(conversation.status) });
      send("message.completed", { messageId: null, queued: true });
      return;
    }

    // Customer asked for a person (configured keywords): hand off straight away.
    if (settings?.handoffEnabled !== false && userText && wantsHuman(userText, settings?.handoffKeywords)) {
      const before = new Date();
      await requestHandoff({ storeId: context.storeId, conversationId: conversation.id, reason: "Customer asked for a person." });
      await sendModeAndEvents(before);
      send("message.completed", { messageId: null });
      return;
    }

    // Nothing for the AI to work with (e.g. a voice note the browser couldn't transcribe).
    if (!userText.trim() && attachments.length > 0) {
      const hasAudio = attachments.some((attachment) => attachment.kind === "audio");
      const text = hasAudio
        ? "I couldn't make out that voice message. Could you type it, or try recording again?"
        : "Thanks, I've got your file. What would you like to know about it?";
      send("message.delta", { text });
      const stored = await appendMessage({ conversationId: conversation.id, role: "assistant", content: text });
      send("message.completed", { messageId: stored.id });
      return;
    }

    // Independent loads, at once. A phone number in the message is saved before the AI reads the
    // customer's saved details (that happens after this).
    const turnStarted = new Date();
    const measuredFrom = input.requestStartedAt ?? turnStarted.getTime();
    const [cart, historyRows, summaryCache] = await Promise.all([
      getCartSummary(context.sessionId, context.storeId, context.store.currency),
      getProviderHistoryRows(conversation.id, 20),
      prisma.conversation.findUnique({
        where: { id: conversation.id },
        select: {
          contextSummary: true,
          contextSummaryCutoff: true,
          contextSummaryUpdatedAt: true,
        },
      }),
      capturePhoneFromSpeech(context, userText),
    ]);
    const { history, cutoff } = buildProviderHistory(historyRows);
    const conversationSummary = await summarizeBeforeCutoff(conversation.id, cutoff, summaryCache).catch(() => "");
    const intent = detectShoppingIntent({ text: userText, cartItemCount: cart.itemCount });
    const aiConfig = resolveAiConfig(settings);
    // "Stop suggesting things" / "show me suggestions again": remembered for this visitor.
    if (intent.optOut || intent.wantsSuggestions) {
      const state = await getEngagementState(context.sessionId).catch(() => null);
      const optedOut = state ? await isOptedOut({ storeId: context.storeId, visitorId: context.visitorId, state }) : false;
      if (state && optedOut !== intent.optOut) {
        await setSuggestionOptOut({ storeId: context.storeId, sessionId: context.sessionId, visitorId: context.visitorId, optOut: intent.optOut });
        if (intent.optOut) {
          await trackEvent({ storeId: context.storeId, sessionId: context.sessionId, visitorId: context.visitorId, type: "proactive_opt_out", meta: { via: "chat" } });
        }
      }
    }
    let missed = false;
    let refused = false;
    let firstTokenMs: number | null = null;
    let toolLog: ToolLogEntry[] = [];
    turnLog = {
      storeId: context.storeId,
      conversationId: conversation.id,
      sessionId: context.sessionId,
      channel: input.channel,
      mode: isLiveAiEnabled(context.store) ? "live" : "demo",
      provider: aiConfig?.providerId ?? "",
      model: aiConfig?.model ?? "",
      userText,
      intent: intent.stage,
      started: measuredFrom,
    };

    for await (const event of runAssistant({
      session: context,
      cart,
      history,
      userText,
      channel: input.channel,
      signal: input.signal,
      conversationSummary,
      attachments,
    })) {
      if (input.signal.aborted) break;
      if (event.type === "delta") {
        if (firstTokenMs === null && event.text.trim()) firstTokenMs = Date.now() - measuredFrom;
        partialText += event.text;
        send("message.delta", { text: event.text });
      } else if (event.type === "status") {
        send("message.status", { tool: event.tool });
      } else if (event.type === "ui") {
        partialParts.push(event.part);
        send("ui.part", { part: event.part });
        if (event.part.type === "cart_summary") send("ui.cart", { cart: event.part.cart });
      } else if (event.type === "usage") {
        turnUsage = addUsage(turnUsage, event.usage);
        usageEventCount += 1;
        const stored = await recordUsage({
          eventKey: `${usageTurnId}:${event.round}`,
          storeId: context.storeId,
          conversationId: conversation.id,
          sessionId: context.sessionId,
          channel: input.channel,
          source: "chat",
          mode: isLiveAiEnabled(context.store) ? "live" : "demo",
          providerId: event.providerId,
          model: event.model,
          requestKind: event.requestKind,
          usage: event.usage,
          rawUsage: event.rawUsage,
        });
        if (stored?.costMicros != null) {
          costMicros += stored.costMicros;
          pricedEventCount += 1;
        } else {
          unpricedEventCount += 1;
        }
      } else if (event.type === "done") {
        missed = Boolean(event.missed);
        refused = Boolean(event.refused);
        toolLog = event.toolLog ?? [];
        persisted = true;
        const stored = await appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: event.content,
          parts: event.parts,
        });
        send("message.completed", { messageId: stored.id });
      }
    }

    if (input.signal.aborted) {
      await persistInterrupted();
      return;
    }

    await recordTurnOutcome({ ...handoffOptions, missed });
    const knowledgeSearched = toolLog.some((entry) => entry.name === "search_knowledge");
    if (missed && !knowledgeSearched && userText.trim()) {
      await captureUnansweredQuestion({
        storeId: context.storeId,
        conversationId: conversation.id,
        question: userText,
        channel: input.channel,
        intent: intent.stage,
        outcome: "missed",
        reason: refused ? "assistant_refused" : "assistant_missed",
      });
    }
    const handedOff = toolLog.some((entry) => entry.name === "request_human" && entry.ok);
    await recordAiTurn({
      ...turnLog,
      outcome: handedOff ? "handoff" : missed ? "missed" : "answered",
      latencyMs: Date.now() - turnLog.started,
      firstTokenMs,
      toolLog,
      ...usageLogFields(),
    });
    // The request_human tool or the miss counter may have handed the chat off during this turn.
    await sendModeAndEvents(turnStarted);
  } catch (error) {
    if (input.signal.aborted) {
      await persistInterrupted();
      return;
    }
    if (turnLog) {
      await recordAiTurn({
        ...turnLog,
        outcome: "error",
        latencyMs: Date.now() - turnLog.started,
        ...usageLogFields(),
      });
    }
    logger.error("widget.message_failed", {
      sessionId: context.sessionId,
      channel: input.channel,
      error: error instanceof Error ? error.message : String(error),
    });
    await recordTurnOutcome({ ...handoffOptions, missed: true }).catch(() => undefined);
    if (userText.trim()) {
      await captureUnansweredQuestion({
        storeId: context.storeId,
        conversationId: conversation.id,
        question: userText,
        channel: input.channel,
        intent: turnLog?.intent ?? "",
        outcome: "error",
        reason: "assistant_error",
      }).catch(() => undefined);
    }
    send("message.error", { message: "I could not finish that reply. Please try again.", retryable: true });
  }
}
