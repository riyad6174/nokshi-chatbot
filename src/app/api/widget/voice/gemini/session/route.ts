import type { NextRequest } from "next/server";
import { z } from "zod";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { jsonError, jsonOk, readJson } from "@/lib/http";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { getSessionContext } from "@/modules/conversations/session.service";
import { trackEvent } from "@/modules/customers/events.service";
import { createGeminiLiveSession } from "@/modules/realtime/gemini-live.service";
import { RealtimeError, voiceEngine } from "@/modules/realtime/realtime.service";
import { voiceAssistantEnabled } from "@/modules/speech/greeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    // Reconnecting a running call (the server rotates connections): continue the same conversation.
    resumeHandle: z.string().trim().min(1).max(2000).optional(),
  })
  .default({});

/** Starts (or resumes) a Gemini live voice call: returns a short-lived single-use token for the browser. */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ipRate = ip === "unknown" ? null : await rateLimit(`gemini-live:ip:${ip}`, 30, 60_000);
  if (ipRate && !ipRate.allowed) return jsonError(429, "rate_limited", "Too many voice calls. Please wait a moment.");

  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session first.");
  const sessionRate = await rateLimit(`gemini-live:session:${sessionId}`, 10, 60_000);
  if (!sessionRate.allowed) return jsonError(429, "rate_limited", "Too many voice calls. Please wait a moment.");

  const parsed = bodySchema.safeParse((await readJson(request).catch(() => null)) ?? {});
  const resumeHandle = parsed.success ? parsed.data.resumeHandle : undefined;

  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired. Please reload the chat.");
  if (!voiceAssistantEnabled(context.store) || voiceEngine(context.store) !== "gemini") {
    return jsonError(403, "realtime_unavailable", "Live voice isn't available for this store.");
  }

  try {
    const grant = await createGeminiLiveSession(context, resumeHandle);
    if (!resumeHandle) {
      await trackEvent({ storeId: context.storeId, sessionId: context.sessionId, visitorId: context.visitorId, type: "voice_turn", meta: { engine: "gemini", event: "call_started" } });
    }
    return jsonOk(grant);
  } catch (error) {
    if (error instanceof RealtimeError) return jsonError(502, "realtime_failed", error.message);
    throw error;
  }
}
