import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import type { ToolLogEntry } from "@/modules/ai/orchestrator";
import type { NormalizedUsage } from "@/modules/ai/usage";

export type TurnOutcome = "answered" | "missed" | "error" | "handoff";

/** Records one assistant turn for reliability reporting. Best effort: never breaks the turn. */
export async function recordAiTurn(input: {
  storeId: string;
  conversationId: string;
  sessionId: string;
  channel: "text" | "voice";
  mode: "live" | "demo";
  provider?: string;
  model?: string;
  outcome: TurnOutcome;
  latencyMs: number;
  firstTokenMs?: number | null;
  toolLog?: ToolLogEntry[];
  userText?: string;
  intent?: string;
  /** Why the turn failed (outcome "error"). */
  errorReason?: string;
  /** The assistant message this turn produced. */
  messageId?: string | null;
  usage?: NormalizedUsage;
  costMicros?: number;
  pricingStatus?: "priced" | "unpriced" | "mixed";
  usageEventCount?: number;
}): Promise<string | null> {
  try {
    const toolCalls = (input.toolLog ?? []).slice(0, 30).map((entry) => ({
      name: entry.name.slice(0, 60),
      ok: entry.ok,
      code: entry.code.slice(0, 60),
      ms: Math.max(0, Math.round(entry.ms)),
    }));
    const created = await prisma.aiTurnLog.create({
      data: {
        storeId: input.storeId,
        conversationId: input.conversationId,
        sessionId: input.sessionId,
        channel: input.channel,
        mode: input.mode,
        provider: (input.provider ?? "").slice(0, 100),
        model: (input.model ?? "").slice(0, 100),
        inputTokens: input.usage?.inputTokens,
        outputTokens: input.usage?.outputTokens,
        cachedInputTokens: input.usage?.cachedInputTokens,
        cacheWriteInputTokens: input.usage?.cacheWriteInputTokens,
        reasoningTokens: input.usage?.reasoningTokens,
        totalTokens: input.usage?.totalTokens,
        costMicros: input.costMicros,
        pricingStatus: input.pricingStatus,
        usageEventCount: input.usageEventCount,
        outcome: input.outcome,
        ...(input.errorReason ? { errorReason: input.errorReason.slice(0, 500) } : {}),
        ...(input.messageId ? { messageId: input.messageId } : {}),
        latencyMs: Math.max(0, Math.round(input.latencyMs)),
        firstTokenMs: input.firstTokenMs == null ? null : Math.max(0, Math.round(input.firstTokenMs)),
        toolCalls,
        toolErrorCount: toolCalls.filter((call) => !call.ok).length,
        userText: (input.userText ?? "").slice(0, 300),
        intent: (input.intent ?? "").slice(0, 40),
      },
    });
    if (input.outcome === "error") logger.warn("ai.turn_error_recorded", { storeId: input.storeId });
    return created.id;
  } catch (error) {
    logger.warn("ai.turn_log_failed", { error: error instanceof Error ? error.message : String(error) });
    return null;
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
