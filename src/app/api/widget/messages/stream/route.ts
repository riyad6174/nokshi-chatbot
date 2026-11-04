import type { NextRequest } from "next/server";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { jsonError, sseEvent, sseHeaders } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db/prisma";
import { conversationMode, getConversationForSession, listConversationMessages } from "@/modules/conversations/conversation.service";
import { getSessionContext } from "@/modules/conversations/session.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STREAM_MS = 25_000;
const CHECK_MS = 1_000;

// GET /api/widget/messages/stream?conversationId=…&after=ISO — server-sent events for agent replies
// and order/handoff events while a human is involved. The server checks the database every second
// (cheap indexed query) and pushes new messages, so agent replies show up within about a second
// instead of the widget polling every 3 s. Works across instances (state is in MongoDB). The stream
// ends after 25 s and the browser's EventSource reconnects with the latest cursor.
// Events: messages {messages, mode, agentName} · ping
export async function GET(request: NextRequest) {
  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session first.");

  const rate = await rateLimit(`stream:${sessionId}`, 12, 60_000);
  if (!rate.allowed) return jsonError(429, "rate_limited", "Reconnecting too fast.");

  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired.");

  const conversationId = request.nextUrl.searchParams.get("conversationId") ?? "";
  const conversation = await getConversationForSession(conversationId, context.sessionId, context.storeId);
  if (!conversation) return jsonError(403, "conversation_forbidden", "That conversation does not belong to this session.");

  const afterParam = request.nextUrl.searchParams.get("after");
  let cursor = afterParam && !Number.isNaN(new Date(afterParam).getTime()) ? new Date(afterParam) : new Date();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(sseEvent(event, data)));
      const deadline = Date.now() + STREAM_MS;
      let lastMode: string | null = null;
      let lastAgent: string | null = null;
      try {
        // Tell EventSource to wait a moment before reconnecting.
        controller.enqueue(encoder.encode("retry: 1500\n\n"));
        while (!request.signal.aborted && Date.now() < deadline) {
          const [messages, fresh] = await Promise.all([
            listConversationMessages(conversation.id, { after: cursor, limit: 50 }),
            prisma.conversation.findUnique({ where: { id: conversation.id }, select: { status: true, assignedName: true } }),
          ]);
          const mode = conversationMode(fresh?.status ?? "bot");
          const agentName = fresh?.assignedName || null;
          if (messages.length > 0 || mode !== lastMode || agentName !== lastAgent) {
            if (messages.length > 0) cursor = new Date(messages[messages.length - 1]!.createdAt);
            lastMode = mode;
            lastAgent = agentName;
            send("messages", { messages, mode, agentName });
          } else {
            send("ping", {});
          }
          await new Promise((resolve) => setTimeout(resolve, CHECK_MS));
        }
      } catch {
        // Client went away or the database hiccuped: the browser reconnects.
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });
  return new Response(stream, { headers: sseHeaders });
}
