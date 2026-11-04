import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import type { ToolLogEntry } from "@/modules/ai/orchestrator";

export type TurnOutcome = "answered" | "missed" | "error" | "handoff";

/** Records one assistant turn for reliability reporting. Best effort: never breaks the turn. */
export async function recordAiTurn(input: {
  storeId: string;
  conversationId: string;
  sessionId: string;
  channel: "text" | "voice";
  mode: "live" | "demo";
  model?: string;
  outcome: TurnOutcome;
  latencyMs: number;
  firstTokenMs?: number | null;
  toolLog?: ToolLogEntry[];
  userText?: string;
  intent?: string;
}): Promise<void> {
  try {
    const toolCalls = (input.toolLog ?? []).slice(0, 30).map((entry) => ({
      name: entry.name.slice(0, 60),
      ok: entry.ok,
      code: entry.code.slice(0, 60),
      ms: Math.max(0, Math.round(entry.ms)),
    }));
    await prisma.aiTurnLog.create({
      data: {
        storeId: input.storeId,
        conversationId: input.conversationId,
        sessionId: input.sessionId,
        channel: input.channel,
        mode: input.mode,
        model: (input.model ?? "").slice(0, 100),
        outcome: input.outcome,
        latencyMs: Math.max(0, Math.round(input.latencyMs)),
        firstTokenMs: input.firstTokenMs == null ? null : Math.max(0, Math.round(input.firstTokenMs)),
        toolCalls,
        toolErrorCount: toolCalls.filter((call) => !call.ok).length,
        userText: (input.userText ?? "").slice(0, 300),
        intent: (input.intent ?? "").slice(0, 40),
      },
    });
    if (input.outcome === "error") logger.warn("ai.turn_error_recorded", { storeId: input.storeId });
  } catch (error) {
    logger.warn("ai.turn_log_failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

/** Recent AI error rate for a store, for health checks and alerting. */
export async function recentAiErrorRate(storeId: string | null, minutes = 15) {
  const since = new Date(Date.now() - minutes * 60_000);
  const where = { ...(storeId ? { storeId } : {}), at: { gte: since } };
  const [total, errors] = await Promise.all([
    prisma.aiTurnLog.count({ where }),
    prisma.aiTurnLog.count({ where: { ...where, outcome: "error" } }),
  ]);
  return { total, errors, rate: total === 0 ? 0 : errors / total };
}
