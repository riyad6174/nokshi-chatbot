import type { NextRequest } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { jsonError, jsonOk, readJson, validationError } from "@/lib/http";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { logger } from "@/lib/logging/logger";
import { getSessionContext } from "@/modules/conversations/session.service";
import { engagementEventSchema, handleEngagementEvent } from "@/modules/sales/engagement.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/widget/engagement: the widget (or the host site via the "nokshi:activity" browser event)
// reports what the shopper did; the server decides whether the assistant says something.
// Response: { show, reason, message?, suggestionId?, nudge?, retryAfterSeconds? }
export async function POST(request: NextRequest) {
  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session first.");

  const rate = await rateLimit(`engagement:${sessionId}`, 30, 60_000);
  if (!rate.allowed) return jsonError(429, "rate_limited", "Too many events.");

  const parsed = engagementEventSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);

  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired.");

  try {
    return jsonOk(await handleEngagementEvent(context, parsed.data));
  } catch (error) {
    // Engagement is optional: a failure must never disturb shopping.
    logger.error("engagement.failed", { type: parsed.data.type, error: error instanceof Error ? error.message : String(error) });
    return jsonOk({ show: false, reason: "error" });
  }
}
