import type { NextRequest } from "next/server";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { jsonError, jsonOk } from "@/lib/http";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getSessionContext } from "@/modules/conversations/session.service";
import { trackEvent } from "@/modules/customers/events.service";
import { createRealtimeSession, RealtimeError, voiceEngine } from "@/modules/realtime/realtime.service";
import { voiceAssistantEnabled } from "@/modules/speech/greeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts a live voice call: returns a short-lived token for the browser's WebRTC connection. */
export async function POST(request: NextRequest) {
  const ipRate = checkRateLimit(`realtime:ip:${getClientIp(request)}`, 10, 60_000);
  if (!ipRate.allowed) return jsonError(429, "rate_limited", "Too many voice calls. Please wait a moment.");

  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session first.");
  const sessionRate = checkRateLimit(`realtime:session:${sessionId}`, 6, 60_000);
  if (!sessionRate.allowed) return jsonError(429, "rate_limited", "Too many voice calls. Please wait a moment.");

  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired. Please reload the chat.");
  if (!voiceAssistantEnabled(context.store) || voiceEngine(context.store) !== "realtime") {
    return jsonError(403, "realtime_unavailable", "Live voice isn't available for this store.");
  }

  try {
    const grant = await createRealtimeSession(context);
    await trackEvent({ storeId: context.storeId, sessionId: context.sessionId, visitorId: context.visitorId, type: "voice_turn", meta: { engine: "realtime", event: "call_started" } });
    return jsonOk(grant);
  } catch (error) {
    if (error instanceof RealtimeError) return jsonError(502, "realtime_failed", error.message);
    throw error;
  }
}
