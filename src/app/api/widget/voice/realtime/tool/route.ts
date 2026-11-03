import type { NextRequest } from "next/server";
import { z } from "zod";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { prisma } from "@/lib/db/prisma";
import { jsonError, jsonOk, readJson, validationError } from "@/lib/http";
import { logger } from "@/lib/logging/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { executeTool } from "@/modules/ai/tools";
import { getSessionContext } from "@/modules/conversations/session.service";
import {
  changesOrderState,
  realtimeInstructions,
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

/** Runs one tool the live voice model called, against the database, exactly as in text chat. */
export async function POST(request: NextRequest) {
  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session first.");
  const rate = checkRateLimit(`realtime-tool:${sessionId}`, 60, 60_000);
  if (!rate.allowed) return jsonError(429, "rate_limited", "Too many requests. Please wait a moment.");

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);

  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired. Please reload the chat.");
  if (voiceEngine(context.store) !== "realtime") return jsonError(403, "realtime_unavailable", "Live voice isn't available.");

  const latestUser = await prisma.message.findFirst({
    where: { conversationId: context.conversationId, role: "user" },
    orderBy: { createdAt: "desc" },
    select: { content: true },
  });
  const turnStartedAt = new Date(Date.now() - (parsed.data.speechAgoMs ?? 0));

  const result = await executeTool(
    { session: context, turnStartedAt, channel: "voice", latestUserText: latestUser?.content ?? "" },
    parsed.data.name,
    parsed.data.arguments,
  );
  if (!result.ok) logger.warn("realtime.tool_rejected", { tool: parsed.data.name });
  if (result.ui?.length) rememberShownParts(context.conversationId, result.ui);

  return jsonOk({
    output: toolOutputForModel(result),
    ui: result.ui ?? [],
    // The cart or order changed: the next order step in the instructions changed with it.
    instructions: changesOrderState(result.ui) ? await realtimeInstructions(context) : null,
  });
}
