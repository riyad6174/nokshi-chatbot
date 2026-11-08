import type { NextRequest } from "next/server";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db/prisma";
import {
  conversationMode,
  getConversationForSession,
  listConversationMessages,
} from "@/modules/conversations/conversation.service";
import { getSessionContext } from "@/modules/conversations/session.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Polled by the widget while a human agent is involved (and occasionally otherwise) to pick up
// agent replies and order/handoff events. Returns messages newer than `after`.
export async function GET(request: NextRequest) {
  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session first.");

  const rate = await rateLimit(`poll:${sessionId}`, 60, 60_000);
  if (!rate.allowed) return jsonError(429, "rate_limited", "Polling too fast.");

  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired.");

  const conversationId = request.nextUrl.searchParams.get("conversationId") ?? "";
  const conversation = await getConversationForSession(conversationId, context.sessionId, context.storeId);
  if (!conversation) return jsonError(403, "conversation_forbidden", "That conversation does not belong to this session.");

  const afterParam = request.nextUrl.searchParams.get("after");
  const after = afterParam ? new Date(afterParam) : undefined;
  const messages = await listConversationMessages(conversation.id, {
    after: after && !Number.isNaN(after.getTime()) ? after : undefined,
    limit: 50,
  });

  const fresh = await prisma.conversation.findUnique({
    where: { id: conversation.id },
    select: { status: true, assignedName: true },
  });
  return jsonOk({
    messages,
    mode: conversationMode(fresh?.status ?? "bot"),
    agentName: fresh?.assignedName || null,
  });
}
