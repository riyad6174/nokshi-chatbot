import type { AiUsageEvent } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isObjectId } from "@/lib/db/ids";
import { logger } from "@/lib/logging/logger";
import { resolveUsageCost } from "@/modules/ai/pricing.service";
import { audioTokensFromOpenAiUsage, makeUsage, normalizeOpenAiUsage, type NormalizedUsage } from "@/modules/ai/usage";
import { randomUUID } from "node:crypto";

export type UsageChannel = "text" | "voice";
export type UsageSource = "chat" | "realtime" | "embedding" | "transcription" | "other";
export type UsageRequestKind = "chat_round" | "realtime_response" | "embedding" | "transcription" | "other";

export const USAGE_PERIODS = [7, 30, 90] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

export type RecordUsageInput = {
  /** Stable idempotency key: turn id + round, realtime response id, etc. */
  eventKey: string;
  storeId: string;
  conversationId?: string | null;
  sessionId?: string | null;
  turnLogId?: string | null;
  messageId?: string | null;
  /** Live voice: the browser's id of the spoken reply (linked to its message once saved). */
  replyKey?: string | null;
  channel: UsageChannel;
  source: UsageSource;
  mode: "live" | "demo";
  providerId: string;
  model: string;
  requestKind: UsageRequestKind;
  usage: NormalizedUsage;
  rawUsage?: unknown;
  at?: Date;
};

function safeRawUsage(raw: unknown): string {
  if (raw == null) return "{}";
  try {
    const serialized = JSON.stringify(raw);
    return serialized.length > 4000 ? `${serialized.slice(0, 4000)}...` : serialized;
  } catch {
    return "{}";
  }
}

/**
 * Records one provider response and updates the conversation roll-up. The raw event is the source
 * of truth; the roll-up is a denormalized cache that can be rebuilt if an update is interrupted.
 */
export async function recordUsage(input: RecordUsageInput): Promise<AiUsageEvent | null> {
  const at = input.at ?? new Date();
  const conversationId =
    input.conversationId && isObjectId(input.conversationId) ? input.conversationId : null;
  const sessionId = input.sessionId && isObjectId(input.sessionId) ? input.sessionId : null;
  const turnLogId = input.turnLogId && isObjectId(input.turnLogId) ? input.turnLogId : null;
  const messageId = input.messageId && isObjectId(input.messageId) ? input.messageId : null;

  try {
    const existing = await prisma.aiUsageEvent.findUnique({ where: { eventKey: input.eventKey } });
    if (existing) return existing;

    const cost = await resolveUsageCost({
      providerId: input.providerId,
      model: input.model,
      usage: input.usage,
    });

    let event: AiUsageEvent;
    try {
      event = await prisma.aiUsageEvent.create({
        data: {
          eventKey: input.eventKey,
          storeId: input.storeId,
          conversationId,
          sessionId,
          turnLogId,
          messageId,
          ...(input.replyKey ? { replyKey: input.replyKey.slice(0, 100) } : {}),
          channel: input.channel,
          source: input.source,
          mode: input.mode,
          providerId: input.providerId.slice(0, 100),
          model: input.model.slice(0, 150),
          requestKind: input.requestKind,
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          cachedInputTokens: input.usage.cachedInputTokens,
          cacheWriteInputTokens: input.usage.cacheWriteInputTokens,
          reasoningTokens: input.usage.reasoningTokens,
          totalTokens: input.usage.totalTokens,
          costMicros: cost.costMicros,
          pricingStatus: cost.pricingStatus,
          pricingVersion: cost.pricingVersion.slice(0, 100),
          rawUsage: safeRawUsage(input.rawUsage),
          at,
        },
      });
    } catch (error) {
      // A concurrent retry may have inserted the same eventKey first.
      if ((error as { code?: string }).code === "P2002") {
        return prisma.aiUsageEvent.findUnique({ where: { eventKey: input.eventKey } });
      }
      throw error;
    }

    if (conversationId) {
      const costMicros = cost.costMicros ?? 0;
      await prisma.conversationUsageSummary.upsert({
        where: { conversationId },
        create: {
          storeId: input.storeId,
          conversationId,
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          cachedInputTokens: input.usage.cachedInputTokens,
          cacheWriteInputTokens: input.usage.cacheWriteInputTokens,
          reasoningTokens: input.usage.reasoningTokens,
          totalTokens: input.usage.totalTokens,
          costMicros,
          pricedEventCount: cost.costMicros == null ? 0 : 1,
          unpricedEventCount: cost.costMicros == null ? 1 : 0,
          eventCount: 1,
          firstEventAt: at,
          lastEventAt: at,
        },
        update: {
          inputTokens: { increment: input.usage.inputTokens },
          outputTokens: { increment: input.usage.outputTokens },
          cachedInputTokens: { increment: input.usage.cachedInputTokens },
          cacheWriteInputTokens: { increment: input.usage.cacheWriteInputTokens },
          reasoningTokens: { increment: input.usage.reasoningTokens },
          totalTokens: { increment: input.usage.totalTokens },
          costMicros: { increment: costMicros },
          pricedEventCount: { increment: cost.costMicros == null ? 0 : 1 },
          unpricedEventCount: { increment: cost.costMicros == null ? 1 : 0 },
          eventCount: { increment: 1 },
          lastEventAt: at,
        },
      });
    }

    return event;
  } catch (error) {
    logger.warn("usage.record_failed", {
      storeId: input.storeId,
      conversationId,
      eventKey: input.eventKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function getConversationUsage(storeId: string, conversationId: string) {
  if (!isObjectId(conversationId)) return null;
  return prisma.conversationUsageSummary.findFirst({
    where: { storeId, conversationId },
  });
}

export type UsageTotals = {
  events: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costMicros: number;
  pricedEvents: number;
  unpricedEvents: number;
  conversations: number;
};

export type UsageBreakdownRow = UsageTotals & {
  key: string;
  label: string;
  providerId?: string;
  model?: string;
  channel?: string;
  source?: string;
};

function emptyTotals(): UsageTotals {
  return {
    events: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    costMicros: 0,
    pricedEvents: 0,
    unpricedEvents: 0,
    conversations: 0,
  };
}

type UsageRow = {
  channel: string;
  source: string;
  providerId: string;
  model: string;
  requestKind: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costMicros: number | null;
  conversationId: string | null;
  at: Date;
};

function addToTotals(
  totals: UsageTotals,
  row: UsageRow,
  conversationIds: Set<string>,
): void {
  totals.events += 1;
  totals.inputTokens += row.inputTokens;
  totals.outputTokens += row.outputTokens;
  totals.cachedInputTokens += row.cachedInputTokens;
  totals.cacheWriteInputTokens += row.cacheWriteInputTokens;
  totals.reasoningTokens += row.reasoningTokens;
  totals.totalTokens += row.totalTokens;
  totals.costMicros += row.costMicros ?? 0;
  if (row.costMicros == null) totals.unpricedEvents += 1;
  else totals.pricedEvents += 1;
  if (row.conversationId) conversationIds.add(row.conversationId);
  totals.conversations = conversationIds.size;
}

function byKey(rows: UsageRow[], keyFor: (row: UsageRow) => { key: string; label: string }) {
  const groups = new Map<string, { totals: UsageTotals; row: UsageRow; conversations: Set<string> }>();
  for (const row of rows) {
    const { key } = keyFor(row);
    const group = groups.get(key) ?? { totals: emptyTotals(), row, conversations: new Set<string>() };
    addToTotals(group.totals, row, group.conversations);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      label: keyFor(group.row).label,
      providerId: group.row.providerId,
      model: group.row.model,
      ...group.totals,
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens);
}

/**
 * Store-level usage for the admin dashboard. Loads the raw ledger for the period and aggregates in
 * memory so the numbers always match the per-conversation summaries.
 */
export async function storeUsage(storeId: string, periodDays: number, now = new Date()) {
  const since = new Date(now.getTime() - periodDays * 86_400_000);
  const rows: UsageRow[] = await prisma.aiUsageEvent.findMany({
    where: { storeId, at: { gte: since } },
    select: {
      channel: true,
      source: true,
      providerId: true,
      model: true,
      requestKind: true,
      inputTokens: true,
      outputTokens: true,
      cachedInputTokens: true,
      cacheWriteInputTokens: true,
      reasoningTokens: true,
      totalTokens: true,
      costMicros: true,
      conversationId: true,
      at: true,
    },
    orderBy: { at: "asc" },
    take: 100_000,
  });

  const totalConversations = new Set<string>();
  const totals = emptyTotals();
  const days = new Map<string, { totals: UsageTotals; conversations: Set<string> }>();
  const conversations = new Map<string, UsageTotals>();
  for (const row of rows) {
    addToTotals(totals, row, totalConversations);
    const day = row.at.toISOString().slice(0, 10);
    const dayGroup = days.get(day) ?? { totals: emptyTotals(), conversations: new Set<string>() };
    addToTotals(dayGroup.totals, row, dayGroup.conversations);
    days.set(day, dayGroup);
    if (row.conversationId) {
      const conversation = conversations.get(row.conversationId) ?? emptyTotals();
      addToTotals(conversation, row, new Set<string>());
      conversations.set(row.conversationId, conversation);
    }
  }

  const topConversationIds = [...conversations.entries()]
    .sort((left, right) => right[1].costMicros - left[1].costMicros || right[1].totalTokens - left[1].totalTokens)
    .slice(0, 10);
  const conversationRows =
    topConversationIds.length === 0
      ? []
      : await prisma.conversation.findMany({
          where: { id: { in: topConversationIds.map(([id]) => id) } },
          select: { id: true, customerName: true, status: true },
        });
  const conversationById = new Map(conversationRows.map((row) => [row.id, row]));
  const topConversations = topConversationIds.map(([id, totalsForConversation]) => {
    const conversation = conversationById.get(id);
    return {
      conversationId: id,
      name: conversation?.customerName || `Conversation ${id.slice(-6)}`,
      status: conversation?.status ?? "",
      ...totalsForConversation,
    };
  });

  const byModel = byKey(rows, (row) => ({
    key: `${row.providerId}:${row.model}:${row.requestKind}`,
    label: `${row.providerId || "unknown provider"} / ${row.model || "unknown model"} · ${row.requestKind.replaceAll("_", " ")}`,
  }));
  const byChannel = byKey(rows, (row) => ({ key: row.channel, label: row.channel }));
  const bySource = byKey(rows, (row) => ({ key: row.source, label: row.source }));

  // Text and cascade-voice turns that reached the model: how many requests and prompt tokens each
  // customer message costs. These are the numbers the token-saving work moves.
  const chatRounds = rows.filter((row) => row.requestKind === "chat_round");
  const liveTurns = await prisma.aiTurnLog.count({ where: { storeId, at: { gte: since }, mode: "live" } });
  const promptTokens = chatRounds.reduce((sum, row) => sum + row.inputTokens + row.cachedInputTokens + row.cacheWriteInputTokens, 0);
  const perTurn = {
    turns: liveTurns,
    callsPerTurn: liveTurns > 0 ? chatRounds.length / liveTurns : null,
    promptTokensPerTurn: liveTurns > 0 ? Math.round(promptTokens / liveTurns) : null,
  };

  return {
    perTurn,
    periodDays,
    since: since.toISOString(),
    totals,
    days: [...days.entries()]
      .map(([date, group]) => ({ date, ...group.totals }))
      .sort((left, right) => left.date.localeCompare(right.date)),
    byModel,
    byChannel,
    bySource,
    topConversations,
    unpriced: byModel.filter((row) => row.unpricedEvents > 0),
  };
}

export type StoreUsage = Awaited<ReturnType<typeof storeUsage>>;

/**
 * Prices usage that was recorded before a matching price existed. A cost is fixed when usage is
 * recorded, so without this, adding a model's price later left all its earlier usage unpriced (and
 * conversation and total costs at $0). Already priced events keep the price they were recorded with.
 * Returns how many events got a price.
 */
export async function repriceUnpricedUsage(): Promise<number> {
  const events = await prisma.aiUsageEvent.findMany({
    where: { pricingStatus: "unpriced" },
    select: {
      id: true,
      storeId: true,
      conversationId: true,
      providerId: true,
      model: true,
      inputTokens: true,
      outputTokens: true,
      cachedInputTokens: true,
      cacheWriteInputTokens: true,
      reasoningTokens: true,
      rawUsage: true,
    },
    take: 50_000,
  });
  const conversations = new Map<string, string>();
  let priced = 0;
  for (const event of events) {
    let raw: unknown = null;
    try {
      raw = JSON.parse(event.rawUsage);
    } catch {
      // Truncated or missing payload: price without the audio split.
    }
    const usage = makeUsage({
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cachedInputTokens: event.cachedInputTokens,
      cacheWriteInputTokens: event.cacheWriteInputTokens,
      reasoningTokens: event.reasoningTokens,
      ...audioTokensFromOpenAiUsage(raw),
    });
    const cost = await resolveUsageCost({ providerId: event.providerId, model: event.model, usage });
    if (cost.costMicros == null) continue;
    await prisma.aiUsageEvent.update({
      where: { id: event.id },
      data: { costMicros: cost.costMicros, pricingStatus: cost.pricingStatus, pricingVersion: cost.pricingVersion.slice(0, 100) },
    });
    priced += 1;
    if (event.conversationId) conversations.set(event.conversationId, event.storeId);
  }
  for (const [conversationId, storeId] of conversations) {
    await rebuildConversationUsage(storeId, conversationId).catch((error) =>
      logger.warn("usage.rebuild_failed", { conversationId, error: error instanceof Error ? error.message : String(error) }),
    );
  }
  return priced;
}

/** Rebuild a conversation summary from the raw ledger. Useful after a failed roll-up write. */
export async function rebuildConversationUsage(storeId: string, conversationId: string) {
  if (!isObjectId(conversationId)) return null;
  const events = await prisma.aiUsageEvent.findMany({
    where: { storeId, conversationId },
    orderBy: { at: "asc" },
  });
  const totals = events.reduce(
    (sum, event) => ({
      inputTokens: sum.inputTokens + event.inputTokens,
      outputTokens: sum.outputTokens + event.outputTokens,
      cachedInputTokens: sum.cachedInputTokens + event.cachedInputTokens,
      cacheWriteInputTokens: sum.cacheWriteInputTokens + event.cacheWriteInputTokens,
      reasoningTokens: sum.reasoningTokens + event.reasoningTokens,
      totalTokens: sum.totalTokens + event.totalTokens,
      costMicros: sum.costMicros + (event.costMicros ?? 0),
      pricedEventCount: sum.pricedEventCount + (event.costMicros == null ? 0 : 1),
      unpricedEventCount: sum.unpricedEventCount + (event.costMicros == null ? 1 : 0),
      eventCount: sum.eventCount + 1,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      costMicros: 0,
      pricedEventCount: 0,
      unpricedEventCount: 0,
      eventCount: 0,
    },
  );

  return prisma.conversationUsageSummary.upsert({
    where: { conversationId },
    create: {
      storeId,
      conversationId,
      ...totals,
      firstEventAt: events[0]?.at ?? null,
      lastEventAt: events[events.length - 1]?.at ?? null,
    },
    update: {
      ...totals,
      firstEventAt: events[0]?.at ?? null,
      lastEventAt: events[events.length - 1]?.at ?? null,
    },
  });
}

/**
 * Speech-to-text usage (cascade voice, or the input transcription of a Realtime call). Fire and
 * forget: a ledger write must never slow down or fail the customer's turn.
 */
export function recordTranscriptionUsage(input: {
  storeId: string;
  conversationId?: string | null;
  sessionId?: string | null;
  providerId: string;
  model: string;
  raw: unknown;
  /** Stable id (e.g. the Realtime item id) so a retried report isn't counted twice. */
  key?: string;
}): void {
  const usage = normalizeOpenAiUsage(input.raw);
  if (!usage) return;
  void recordUsage({
    eventKey: `transcription:${input.storeId}:${input.key ?? randomUUID()}`,
    storeId: input.storeId,
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    channel: "voice",
    source: "transcription",
    mode: "live",
    providerId: input.providerId,
    model: input.model,
    requestKind: "transcription",
    usage,
    rawUsage: input.raw,
  }).catch(() => undefined);
}
