import { prisma } from "@/lib/db/prisma";
import { usageBreakdown, type UsageBreakdown } from "@/modules/ai/usage";

// Token observability for one inbox conversation: every model request, tied to the message it
// produced, grouped into sessions (a visit, or a voice call), with totals by token kind, channel,
// model and session. Built from the usage ledger (AiUsageEvent), the turn log (latency, tools) and
// voice call starts. Rows recorded before requests were linked to messages are attributed to the
// nearest AI reply in time and marked "estimated"; anything left over still counts in its session.

/** A new session starts after this long with no messages. */
export const SESSION_GAP_MS = 30 * 60_000;
/** An unlinked usage row belongs to an AI reply saved within this long of it. */
const ESTIMATE_WINDOW_MS = 30_000;

export type TokenTotals = UsageBreakdown & {
  requests: number;
  total: number;
  /** Sum of priced requests (USD micros). */
  costMicros: number;
  /** Requests with no price (model missing from the price table). */
  unpriced: number;
};

export type ObsRequest = {
  id: string;
  at: string;
  providerId: string;
  model: string;
  channel: string;
  kind: string;
  tokens: UsageBreakdown & { total: number };
  costMicros: number | null;
  /** exact: linked when recorded · estimated: nearest reply in time · none: only the session knows it. */
  attribution: "exact" | "estimated" | "none";
  messageId: string | null;
};

export type ObsMessage = {
  messageId: string;
  requests: ObsRequest[];
  totals: TokenTotals;
  /** Text replies: time to the full reply and to the first words, and the tools it used. */
  latencyMs: number | null;
  firstTokenMs: number | null;
  tools: string[];
};

export type ObsSession = {
  index: number;
  kind: "visit" | "voice_call";
  start: string;
  end: string;
  durationMs: number;
  messageIds: string[];
  totals: TokenTotals;
  /** Requests in this session that couldn't be tied to a message. */
  unattributed: ObsRequest[];
};

export type ConversationObservability = {
  sessions: ObsSession[];
  byMessage: Record<string, ObsMessage>;
  /** Session index for each message id (for dividers). */
  sessionOf: Record<string, number>;
  totals: TokenTotals;
  byChannel: Record<string, TokenTotals>;
  byModel: Array<{ model: string; providerId: string; totals: TokenTotals }>;
  requests: ObsRequest[];
  customerTurns: number;
  /** Share of input tokens served from the provider's cache (0..1). */
  cacheHitRate: number;
  /** Total tokens per customer message. */
  tokensPerTurn: number;
  topRequests: ObsRequest[];
};

export function emptyTotals(): TokenTotals {
  return { requests: 0, inputText: 0, inputAudio: 0, cached: 0, output: 0, outputAudio: 0, thinking: 0, total: 0, costMicros: 0, unpriced: 0 };
}

function addRequest(totals: TokenTotals, request: ObsRequest) {
  totals.requests += 1;
  totals.inputText += request.tokens.inputText;
  totals.inputAudio += request.tokens.inputAudio;
  totals.cached += request.tokens.cached;
  totals.output += request.tokens.output;
  totals.outputAudio += request.tokens.outputAudio;
  totals.thinking += request.tokens.thinking;
  totals.total += request.tokens.total;
  if (request.costMicros == null) totals.unpriced += 1;
  else totals.costMicros += request.costMicros;
}

type MessageLike = { id: string; role: string; createdAt: Date | string };
const time = (value: Date | string) => (value instanceof Date ? value.getTime() : Date.parse(value));

/**
 * Splits a conversation into sessions: a new one after `gapMs` with no messages, and a voice call
 * session wherever a call started (from that moment until the next gap or call).
 */
export function splitSessions(
  messages: MessageLike[],
  callStarts: Array<Date | string>,
  gapMs = SESSION_GAP_MS,
): Array<{ kind: "visit" | "voice_call"; start: number; end: number; messageIds: string[] }> {
  const sorted = [...messages].sort((left, right) => time(left.createdAt) - time(right.createdAt));
  const calls = callStarts.map(time).sort((left, right) => left - right);
  const sessions: Array<{ kind: "visit" | "voice_call"; start: number; end: number; messageIds: string[] }> = [];
  let previous: number | null = null;
  for (const message of sorted) {
    const at = time(message.createdAt);
    // A call that started since the previous message (or shortly before the first one) opens a session.
    const call = calls.filter((start) => start <= at && (previous === null ? at - start <= gapMs : start > previous)).at(-1);
    const gap = previous !== null && at - previous >= gapMs;
    if (previous === null || call !== undefined || gap) {
      sessions.push({ kind: call !== undefined ? "voice_call" : "visit", start: call ?? at, end: at, messageIds: [] });
    }
    const current = sessions.at(-1)!;
    current.messageIds.push(message.id);
    current.end = at;
    previous = at;
  }
  return sessions;
}

type UsageRow = {
  id: string;
  at: Date;
  providerId: string;
  model: string;
  channel: string;
  requestKind: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costMicros: number | null;
  rawUsage: string;
  messageId: string | null;
};

type TurnLogRow = { messageId: string | null; latencyMs: number; firstTokenMs: number | null; toolCalls: Array<{ name: string }> };

/** The whole report from loaded rows (no database access: easy to test). */
export function buildConversationObservability(input: {
  messages: MessageLike[];
  usage: UsageRow[];
  turnLogs?: TurnLogRow[];
  callStarts?: Array<Date | string>;
  gapMs?: number;
}): ConversationObservability {
  const messages = [...input.messages].sort((left, right) => time(left.createdAt) - time(right.createdAt));
  const messageIds = new Set(messages.map((message) => message.id));
  const aiMessages = messages.filter((message) => message.role === "assistant");

  const requests: ObsRequest[] = [...input.usage]
    .sort((left, right) => left.at.getTime() - right.at.getTime())
    .map((row) => {
      const tokens = usageBreakdown(row);
      let messageId = row.messageId && messageIds.has(row.messageId) ? row.messageId : null;
      let attribution: ObsRequest["attribution"] = messageId ? "exact" : "none";
      if (!messageId) {
        const at = row.at.getTime();
        let best: { id: string; distance: number } | null = null;
        for (const message of aiMessages) {
          const distance = Math.abs(time(message.createdAt) - at);
          if (distance <= ESTIMATE_WINDOW_MS && (!best || distance < best.distance)) best = { id: message.id, distance };
        }
        if (best) {
          messageId = best.id;
          attribution = "estimated";
        }
      }
      return {
        id: row.id,
        at: row.at.toISOString(),
        providerId: row.providerId,
        model: row.model,
        channel: row.channel,
        kind: row.requestKind,
        tokens: { ...tokens, total: tokens.inputText + tokens.inputAudio + tokens.cached + tokens.output },
        costMicros: row.costMicros,
        attribution,
        messageId,
      };
    });

  const turnByMessage = new Map((input.turnLogs ?? []).filter((log) => log.messageId).map((log) => [log.messageId!, log]));
  const byMessage: Record<string, ObsMessage> = {};
  for (const request of requests) {
    if (!request.messageId) continue;
    const turn = turnByMessage.get(request.messageId);
    const entry = (byMessage[request.messageId] ??= {
      messageId: request.messageId,
      requests: [],
      totals: emptyTotals(),
      latencyMs: turn?.latencyMs ?? null,
      firstTokenMs: turn?.firstTokenMs ?? null,
      tools: (turn?.toolCalls ?? []).map((call) => call.name),
    });
    entry.requests.push(request);
    addRequest(entry.totals, request);
  }

  const split = splitSessions(messages, input.callStarts ?? [], input.gapMs);
  const sessionOf: Record<string, number> = {};
  const sessions: ObsSession[] = split.map((session, index) => {
    for (const id of session.messageIds) sessionOf[id] = index;
    return {
      index,
      kind: session.kind,
      start: new Date(session.start).toISOString(),
      end: new Date(session.end).toISOString(),
      durationMs: Math.max(0, session.end - session.start),
      messageIds: session.messageIds,
      totals: emptyTotals(),
      unattributed: [],
    };
  });
  for (const request of requests) {
    let index = request.messageId ? sessionOf[request.messageId] : undefined;
    if (index === undefined) {
      // Not tied to a message: the last session that started before it.
      const at = Date.parse(request.at);
      index = Math.max(0, sessions.findLastIndex((session) => Date.parse(session.start) <= at + ESTIMATE_WINDOW_MS));
      sessions[index]?.unattributed.push(request);
    }
    if (sessions[index]) addRequest(sessions[index]!.totals, request);
  }

  const totals = emptyTotals();
  const byChannel: Record<string, TokenTotals> = {};
  const models = new Map<string, { model: string; providerId: string; totals: TokenTotals }>();
  for (const request of requests) {
    addRequest(totals, request);
    addRequest((byChannel[request.channel] ??= emptyTotals()), request);
    const key = `${request.providerId}:${request.model}`;
    const model = models.get(key) ?? { model: request.model, providerId: request.providerId, totals: emptyTotals() };
    addRequest(model.totals, request);
    models.set(key, model);
  }
  const customerTurns = messages.filter((message) => message.role === "user").length;
  const inputAll = totals.inputText + totals.inputAudio + totals.cached;

  return {
    sessions,
    byMessage,
    sessionOf,
    totals,
    byChannel,
    byModel: [...models.values()].sort((left, right) => right.totals.total - left.totals.total),
    requests,
    customerTurns,
    cacheHitRate: inputAll > 0 ? totals.cached / inputAll : 0,
    tokensPerTurn: customerTurns > 0 ? Math.round(totals.total / customerTurns) : 0,
    topRequests: [...requests].sort((left, right) => (right.costMicros ?? 0) - (left.costMicros ?? 0) || right.tokens.total - left.tokens.total).slice(0, 5),
  };
}

/** Loads and builds the report for an inbox conversation. */
export async function loadConversationObservability(input: {
  storeId: string;
  conversationId: string;
  sessionId: string;
  messages: MessageLike[];
}): Promise<ConversationObservability> {
  const [usage, turnLogs, calls] = await Promise.all([
    prisma.aiUsageEvent.findMany({
      where: { storeId: input.storeId, conversationId: input.conversationId },
      orderBy: { at: "asc" },
      take: 5000,
      select: {
        id: true,
        at: true,
        providerId: true,
        model: true,
        channel: true,
        requestKind: true,
        inputTokens: true,
        cachedInputTokens: true,
        outputTokens: true,
        reasoningTokens: true,
        totalTokens: true,
        costMicros: true,
        rawUsage: true,
        messageId: true,
      },
    }),
    prisma.aiTurnLog.findMany({
      where: { storeId: input.storeId, conversationId: input.conversationId, messageId: { not: null } },
      select: { messageId: true, latencyMs: true, firstTokenMs: true, toolCalls: true },
    }),
    prisma.customerEvent.findMany({
      where: { storeId: input.storeId, sessionId: input.sessionId, type: "voice_turn", meta: { contains: "call_started" } },
      select: { at: true },
      orderBy: { at: "asc" },
    }),
  ]);
  return buildConversationObservability({
    messages: input.messages,
    usage,
    turnLogs,
    callStarts: calls.map((call) => call.at),
  });
}

/** Sessions only (dividers), without loading usage: used when the token report is off. */
export async function loadConversationSessions(input: { storeId: string; sessionId: string; messages: MessageLike[] }) {
  const calls = await prisma.customerEvent.findMany({
    where: { storeId: input.storeId, sessionId: input.sessionId, type: "voice_turn", meta: { contains: "call_started" } },
    select: { at: true },
    orderBy: { at: "asc" },
  });
  return splitSessions(input.messages, calls.map((call) => call.at));
}
