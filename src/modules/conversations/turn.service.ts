import type { Conversation, MessageAttachment } from "@prisma/client";
import { logger } from "@/lib/logging/logger";
import { prisma } from "@/lib/db/prisma";
import {
  appendMessage,
  conversationMode,
  getProviderHistory,
  listConversationMessages,
} from "@/modules/conversations/conversation.service";
import { recordTurnOutcome, requestHandoff, wantsHuman } from "@/modules/conversations/handoff.service";
import type { SessionContext } from "@/modules/conversations/session.service";
import { getCartSummary } from "@/modules/cart/cart.service";
import { runAssistant } from "@/modules/ai/run";
import { findPhoneNumber } from "@/lib/digits";
import { upsertProfile } from "@/modules/customers/profile.service";
import type { ChatPart } from "@/types/chat";

export type TurnChannel = "text" | "voice";
export type TurnSend = (event: string, data: unknown) => void;

/**
 * One customer turn after their message is stored: human-handoff checks, the AI reply (text deltas
 * and UI parts), persistence and miss tracking. Shared by the text and voice endpoints, which only
 * differ in how the customer's words arrive and how the reply is delivered.
 *
 * SSE events sent: message.delta {text} · ui.part {part} · ui.cart {cart} · message.event {message}
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
}): Promise<void> {
  const { context, conversation, userText, attachments, send } = input;
  const settings = context.store.settings;
  const handoffOptions = {
    storeId: context.storeId,
    conversationId: conversation.id,
    handoffEnabled: settings?.handoffEnabled !== false,
    handoffAfterMisses: settings?.handoffAfterMisses ?? 2,
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

    // A phone number in what the customer said is saved right away, so it's never lost or re-asked.
    const phone = findPhoneNumber(userText);
    if (phone) {
      await upsertProfile({ storeId: context.storeId, visitorId: context.visitorId }, { phone, preferredLocale: context.locale }).catch(
        () => undefined,
      );
    }

    const cart = await getCartSummary(context.sessionId, context.storeId, context.store.currency);
    const history = await getProviderHistory(conversation.id, 20);
    const turnStarted = new Date();
    let missed = false;

    for await (const event of runAssistant({
      session: context,
      cart,
      history,
      userText,
      channel: input.channel,
      signal: input.signal,
    })) {
      if (input.signal.aborted) break;
      if (event.type === "delta") {
        partialText += event.text;
        send("message.delta", { text: event.text });
      } else if (event.type === "ui") {
        partialParts.push(event.part);
        send("ui.part", { part: event.part });
        if (event.part.type === "cart_summary") send("ui.cart", { cart: event.part.cart });
      } else if (event.type === "done") {
        missed = Boolean(event.missed);
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
    // The request_human tool or the miss counter may have handed the chat off during this turn.
    await sendModeAndEvents(turnStarted);
  } catch (error) {
    if (input.signal.aborted) {
      await persistInterrupted();
      return;
    }
    logger.error("widget.message_failed", {
      sessionId: context.sessionId,
      channel: input.channel,
      error: error instanceof Error ? error.message : String(error),
    });
    await recordTurnOutcome({ ...handoffOptions, missed: true }).catch(() => undefined);
    send("message.error", { message: "I could not finish that reply. Please try again.", retryable: true });
  }
}
