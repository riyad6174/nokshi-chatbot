import type { NextRequest } from "next/server";
import { z } from "zod";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { prisma } from "@/lib/db/prisma";
import { jsonError, jsonOk, readJson, validationError } from "@/lib/http";
import { logger } from "@/lib/logging/logger";
import { rateLimit } from "@/lib/rate-limit";
import { executeTool } from "@/modules/ai/tools";
import { getSessionContext } from "@/modules/conversations/session.service";
import {
  changesOrderState,
  pickWaitFiller,
  realtimeStateNote,
  rememberShownParts,
  toolOutputForModel,
  voiceEngine,
} from "@/modules/realtime/realtime.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  arguments: z.string().max(20_000).default("{}"),
  // How long ago (ms) the customer started the utterance this reply answers. confirm_order uses it
  // to require the "yes" to come after the order summary, never in the same breath.
  speechAgoMs: z.number().int().min(0).max(10 * 60_000).optional(),
});

/** Tools that use ToolContext.latestUserText (consent evidence, "did they ask for a person"). */
const TOOLS_READING_LATEST_TEXT = new Set(["save_customer_profile", "request_human"]);

/** Runs one tool the live voice model called, against the database, exactly as in text chat. */
export async function POST(request: NextRequest) {
  const started = Date.now();
  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session first.");
  const rate = await rateLimit(`realtime-tool:${sessionId}`, 60, 60_000);
  if (!rate.allowed) return jsonError(429, "rate_limited", "Too many requests. Please wait a moment.");

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);

  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired. Please reload the chat.");
  if (voiceEngine(context.store) !== "realtime") return jsonError(403, "realtime_unavailable", "Live voice isn't available.");

  // Only these tools read the customer's latest words; skip the lookup for the rest (every call waits on it).
  const latestUser = TOOLS_READING_LATEST_TEXT.has(parsed.data.name)
    ? await prisma.message.findFirst({
        where: { conversationId: context.conversationId, role: "user" },
        orderBy: { createdAt: "desc" },
        select: { content: true },
      })
    : null;
  const turnStartedAt = new Date(Date.now() - (parsed.data.speechAgoMs ?? 0));

  const result = await executeTool(
    { session: context, turnStartedAt, channel: "voice", latestUserText: latestUser?.content ?? "" },
    parsed.data.name,
    parsed.data.arguments,
  );
  if (!result.ok) logger.warn("realtime.tool_rejected", { tool: parsed.data.name });
  if (result.ui?.length) rememberShownParts(context.conversationId, result.ui);
  // The cart or order changed: the next order step changed with it, and the model's very next words
  // should already follow it. It goes inside the tool result, not into the session instructions:
  // changing those mid-call breaks the prompt cache for the rest of the call.
  const orderState = changesOrderState(result.ui) ? await realtimeStateNote(context).catch(() => null) : null;
  logger.info("realtime.tool_timing", { tool: parsed.data.name, ok: result.ok, ms: Date.now() - started, refreshed: orderState !== null });

  // A different filler for the next pause each time, chosen here (models repeat one phrase if left to pick).
  const nextFiller = pickWaitFiller(context.conversationId);
  return jsonOk({ output: toolOutputForModel(result, orderState, nextFiller), ui: result.ui ?? [] });
}
