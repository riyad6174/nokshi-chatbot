import type { NextRequest } from "next/server";
import { z } from "zod";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { jsonError, jsonOk, readJson, validationError } from "@/lib/http";
import { prisma } from "@/lib/db/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { recordTranscriptionUsage, recordUsage } from "@/modules/analytics/usage.service";
import { getSessionContext } from "@/modules/conversations/session.service";
import { geminiLiveSettings, normalizeGeminiUsage } from "@/modules/realtime/gemini-live.service";
import { REALTIME_TRANSCRIBE_MODEL, realtimeSettings } from "@/modules/realtime/realtime.service";
import { normalizeRealtimeUsage } from "@/modules/ai/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  responseId: z.string().trim().min(1).max(200),
  model: z.string().trim().max(150).optional(),
  usage: z.record(z.unknown()),
  /**
   * "transcription": the input transcription of one customer utterance (responseId = item id).
   * "gemini": one Gemini Live `usageMetadata` report (responseId = a per-call counter).
   */
  kind: z.enum(["response", "transcription", "gemini"]).default("response"),
  /** The browser's id of the spoken reply this response belongs to (links it to the saved message). */
  replyKey: z.string().trim().min(1).max(100).optional(),
});

/**
 * Records usage for one OpenAI Realtime response. The browser gets the usage in
 * `response.done.response.usage`; this endpoint keeps the server-side ledger authoritative and
 * uses the response id for retry-safe idempotency.
 */
export async function POST(request: NextRequest) {
  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session first.");
  const rate = await rateLimit(`realtime-usage:${sessionId}`, 180, 60_000);
  if (!rate.allowed) return jsonError(429, "rate_limited", "Too many usage reports. Please wait a moment.");

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);

  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired. Please reload the chat.");

  if (parsed.data.kind === "transcription") {
    recordTranscriptionUsage({
      storeId: context.storeId,
      conversationId: context.conversationId,
      sessionId: context.sessionId,
      providerId: "openai",
      model: REALTIME_TRANSCRIBE_MODEL,
      raw: parsed.data.usage,
      key: parsed.data.responseId,
    });
    return jsonOk({ recorded: true });
  }

  if (parsed.data.kind === "gemini") {
    const usage = normalizeGeminiUsage(parsed.data.usage);
    if (!usage) return jsonOk({ recorded: false });
    const event = await recordUsage({
      eventKey: `gemini-live:${context.storeId}:${parsed.data.responseId}`,
      replyKey: parsed.data.replyKey,
      storeId: context.storeId,
      conversationId: context.conversationId,
      sessionId: context.sessionId,
      channel: "voice",
      source: "realtime",
      mode: "live",
      providerId: "gemini",
      model: parsed.data.model?.trim() || geminiLiveSettings(context.store).model,
      requestKind: "realtime_response",
      usage,
      rawUsage: parsed.data.usage,
    });
    await linkToSavedReply(context.conversationId, parsed.data.replyKey, event?.id);
    return jsonOk({ recorded: event !== null });
  }

  const usage = normalizeRealtimeUsage(parsed.data.usage);
  if (!usage) return jsonOk({ recorded: false });

  const event = await recordUsage({
    eventKey: `realtime:${context.storeId}:${parsed.data.responseId}`,
    replyKey: parsed.data.replyKey,
    storeId: context.storeId,
    conversationId: context.conversationId,
    sessionId: context.sessionId,
    channel: "voice",
    source: "realtime",
    mode: "live",
    providerId: "openai",
    model: parsed.data.model?.trim() || realtimeSettings(context.store).model,
    requestKind: "realtime_response",
    usage,
    rawUsage: parsed.data.usage,
  });

  await linkToSavedReply(context.conversationId, parsed.data.replyKey, event?.id);
  return jsonOk({ recorded: event !== null });
}

/** The reply may already be saved (its transcript arrived first): tie this usage row to it now. */
async function linkToSavedReply(conversationId: string, replyKey: string | undefined, eventId: string | undefined) {
  if (!replyKey || !eventId) return;
  const message = await prisma.message.findFirst({ where: { conversationId, replyKey }, select: { id: true } });
  if (message) await prisma.aiUsageEvent.update({ where: { id: eventId }, data: { messageId: message.id } }).catch(() => undefined);
}
