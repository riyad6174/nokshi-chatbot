import type { NextRequest } from "next/server";
import { logger } from "@/lib/logging/logger";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { jsonError, readJson, sseEvent, sseHeaders, validationError } from "@/lib/http";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { prisma } from "@/lib/db/prisma";
import { widgetMessageRequestSchema } from "@/lib/validation/schemas";
import {
  appendMessage,
  conversationMode,
  getConversationForSession,
  getProviderHistory,
  listConversationMessages,
  toChatMessage,
} from "@/modules/conversations/conversation.service";
import { recordTurnOutcome, requestHandoff, wantsHuman } from "@/modules/conversations/handoff.service";
import { getSessionContext, touchSession, resolveLocaleForStore } from "@/modules/conversations/session.service";
import { claimUploads } from "@/modules/conversations/upload.service";
import { getCartSummary } from "@/modules/cart/cart.service";
import { runAssistant } from "@/modules/ai/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SSE events: message.started · message.delta {text} · ui.part {part} · ui.cart {cart}
// · message.event {message} (handoff/order events) · conversation.mode {mode}
// · message.completed {messageId, userMessage} · message.error {message, retryable}

export async function POST(request: NextRequest) {
  const ipRate = checkRateLimit(`message:ip:${getClientIp(request)}`, 60, 60_000);
  if (!ipRate.allowed) return jsonError(429, "rate_limited", "Too many messages. Please wait a moment and try again.");

  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session before sending a message.");

  const sessionRate = checkRateLimit(`message:session:${sessionId}`, 20, 60_000);
  if (!sessionRate.allowed) return jsonError(429, "rate_limited", "Too many messages. Please wait a moment and try again.");

  const body = await readJson(request);
  const parsed = widgetMessageRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired. Please reload the chat.");

  const conversation = await getConversationForSession(parsed.data.conversationId, context.sessionId, context.storeId);
  if (!conversation) return jsonError(403, "conversation_forbidden", "That conversation does not belong to this session.");
  if (conversation.status === "closed") {
    return jsonError(409, "conversation_closed", "This conversation was closed. Starting a new one.");
  }

  if (parsed.data.locale) {
    context.locale = resolveLocaleForStore(context.store, parsed.data.locale);
    await touchSession(context.sessionId, context.locale);
  } else {
    await touchSession(context.sessionId);
  }

  const attachments = await claimUploads({
    storeId: context.storeId,
    sessionId: context.sessionId,
    conversationId: conversation.id,
    items: parsed.data.attachments,
  });
  const userMessage = await appendMessage({
    conversationId: conversation.id,
    role: "user",
    content: parsed.data.message,
    attachments,
  });

  // The text the AI sees: typed text, or a voice transcript, plus attachment notes (via history).
  const transcript = attachments.find((attachment) => attachment.kind === "audio")?.transcript ?? "";
  const userText = parsed.data.message || transcript;
  const settings = context.store.settings;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };
      const sendModeAndEvents = async (since: Date) => {
        const current = await prisma.conversation.findUnique({ where: { id: conversation.id }, select: { status: true } });
        const events = await listConversationMessages(conversation.id, { after: since });
        for (const message of events.filter((entry) => entry.role === "event")) send("message.event", { message });
        send("conversation.mode", { mode: conversationMode(current?.status ?? "bot") });
      };

      try {
        send("message.started", { userMessage: toChatMessage(userMessage) });

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
          const persisted = await appendMessage({ conversationId: conversation.id, role: "assistant", content: text });
          send("message.completed", { messageId: persisted.id });
          return;
        }

        const cart = await getCartSummary(context.sessionId, context.storeId, context.store.currency);
        const history = await getProviderHistory(conversation.id, 20);
        const turnStarted = new Date();
        let missed = false;

        for await (const event of runAssistant({ session: context, cart, history, userText, signal: request.signal })) {
          if (request.signal.aborted) break;
          if (event.type === "delta") {
            send("message.delta", { text: event.text });
          } else if (event.type === "ui") {
            send("ui.part", { part: event.part });
            if (event.part.type === "cart_summary") send("ui.cart", { cart: event.part.cart });
          } else if (event.type === "done") {
            missed = Boolean(event.missed);
            const persisted = await appendMessage({
              conversationId: conversation.id,
              role: "assistant",
              content: event.content,
              parts: event.parts,
            });
            send("message.completed", { messageId: persisted.id });
          }
        }

        await recordTurnOutcome({
          storeId: context.storeId,
          conversationId: conversation.id,
          missed,
          handoffEnabled: settings?.handoffEnabled !== false,
          handoffAfterMisses: settings?.handoffAfterMisses ?? 2,
        });
        // The request_human tool or the miss counter may have handed the chat off during this turn.
        await sendModeAndEvents(turnStarted);
      } catch (error) {
        if (!request.signal.aborted) {
          logger.error("widget.message_failed", {
            sessionId: context.sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
          await recordTurnOutcome({
            storeId: context.storeId,
            conversationId: conversation.id,
            missed: true,
            handoffEnabled: settings?.handoffEnabled !== false,
            handoffAfterMisses: settings?.handoffAfterMisses ?? 2,
          }).catch(() => undefined);
          send("message.error", { message: "I could not finish that reply. Please try again.", retryable: true });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // The client may already have closed the stream.
        }
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
}
