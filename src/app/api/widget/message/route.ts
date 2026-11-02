import type { NextRequest } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { jsonError, readJson, sseEvent, sseHeaders, validationError } from "@/lib/http";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { widgetMessageRequestSchema } from "@/lib/validation/schemas";
import { appendMessage, getConversationForSession, toChatMessage } from "@/modules/conversations/conversation.service";
import { getSessionContext, touchSession, resolveLocaleForStore } from "@/modules/conversations/session.service";
import { claimUploads } from "@/modules/conversations/upload.service";
import { runConversationTurn } from "@/modules/conversations/turn.service";

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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        } catch {
          // The customer interrupted and the client closed the stream; keep finishing server-side.
          closed = true;
        }
      };

      try {
        send("message.started", { userMessage: toChatMessage(userMessage) });
        await runConversationTurn({
          context,
          conversation,
          userText,
          attachments,
          channel: "text",
          signal: request.signal,
          send,
        });
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
