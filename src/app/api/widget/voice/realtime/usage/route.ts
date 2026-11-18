import type { NextRequest } from "next/server";
import { z } from "zod";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { jsonError, jsonOk, readJson, validationError } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { recordUsage } from "@/modules/analytics/usage.service";
import { getSessionContext } from "@/modules/conversations/session.service";
import { realtimeSettings } from "@/modules/realtime/realtime.service";
import { normalizeRealtimeUsage } from "@/modules/ai/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  responseId: z.string().trim().min(1).max(200),
  model: z.string().trim().max(150).optional(),
  usage: z.record(z.unknown()),
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

  const usage = normalizeRealtimeUsage(parsed.data.usage);
  if (!usage) return jsonOk({ recorded: false });

  const event = await recordUsage({
    eventKey: `realtime:${context.storeId}:${parsed.data.responseId}`,
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

  return jsonOk({ recorded: event !== null });
}
