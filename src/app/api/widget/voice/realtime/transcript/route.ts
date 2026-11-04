import type { NextRequest } from "next/server";
import { z } from "zod";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { jsonError, jsonOk, readJson, validationError } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { appendMessage, toChatMessage } from "@/modules/conversations/conversation.service";
import { recordTurnOutcome } from "@/modules/conversations/handoff.service";
import { getSessionContext } from "@/modules/conversations/session.service";
import { trackEvent } from "@/modules/customers/events.service";
import { capturePhoneFromSpeech } from "@/modules/customers/profile.service";
import { takeShownParts } from "@/modules/realtime/realtime.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().max(4000),
  // The reply was cut off because the customer started talking.
  interrupted: z.boolean().default(false),
});

/**
 * Saves one side of a live voice exchange into the conversation, so the chat, the admin inbox, the
 * reminders and the AI's memory all see voice the same way as typed chat.
 */
export async function POST(request: NextRequest) {
  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session first.");
  const rate = await rateLimit(`realtime-transcript:${sessionId}`, 120, 60_000);
  if (!rate.allowed) return jsonError(429, "rate_limited", "Too many requests. Please wait a moment.");

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);
  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired. Please reload the chat.");

  const { role, text, interrupted } = parsed.data;
  if (role === "user") {
    if (!text) return jsonOk({ message: null });
    const message = await appendMessage({ conversationId: context.conversationId, role: "user", content: text });
    await capturePhoneFromSpeech(context, text);
    await trackEvent({ storeId: context.storeId, sessionId: context.sessionId, visitorId: context.visitorId, type: "voice_turn", meta: { engine: "realtime" } });
    return jsonOk({ message: toChatMessage(message) });
  }

  const parts = takeShownParts(context.conversationId);
  if (!text && parts.length === 0) return jsonOk({ message: null });
  const content = interrupted && text ? `${text} (interrupted)` : text;
  const message = await appendMessage({
    conversationId: context.conversationId,
    role: "assistant",
    content,
    parts: [...(text ? [{ type: "text" as const, text: interrupted ? `${text} …` : text }] : []), ...parts],
  });
  await recordTurnOutcome({
    storeId: context.storeId,
    conversationId: context.conversationId,
    missed: false,
    handoffEnabled: context.store.settings?.handoffEnabled !== false,
    handoffAfterMisses: context.store.settings?.handoffAfterMisses ?? 2,
  }).catch(() => undefined);
  return jsonOk({ message: toChatMessage(message) });
}
