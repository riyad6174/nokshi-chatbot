import { describe, expect, it } from "vitest";
import { buildConversationObservability, splitSessions } from "@/modules/analytics/conversation-observability";
import { usageBreakdown } from "@/modules/ai/usage";

const t = (minutes: number, seconds = 0) => new Date(Date.UTC(2026, 10, 25, 10, minutes, seconds));
const msg = (id: string, role: string, minutes: number, seconds = 0) => ({ id, role, createdAt: t(minutes, seconds) });

// A real gemini-3.8-live usageMetadata payload shape (production, 24 Nov).
const geminiRaw = JSON.stringify({
  promptTokenCount: 9000,
  responseTokenCount: 80,
  thoughtsTokenCount: 101,
  promptTokensDetails: [{ modality: "TEXT", tokenCount: 7542 }, { modality: "AUDIO", tokenCount: 1458 }],
  responseTokensDetails: [{ modality: "AUDIO", tokenCount: 80 }],
});
const usage = (id: string, at: Date, messageId: string | null, extra: Partial<{ costMicros: number | null; channel: string; model: string }> = {}) => ({
  id,
  at,
  providerId: "gemini",
  model: extra.model ?? "gemini-3.8-live",
  channel: extra.channel ?? "voice",
  requestKind: "realtime_response",
  inputTokens: 9000,
  cachedInputTokens: 0,
  outputTokens: 181,
  reasoningTokens: 101,
  totalTokens: 9181,
  costMicros: extra.costMicros === undefined ? 12_000 : extra.costMicros,
  rawUsage: geminiRaw,
  messageId,
});

describe("token split", () => {
  it("separates text and audio input, audio output and thinking (Gemini Live)", () => {
    expect(usageBreakdown({ inputTokens: 9000, cachedInputTokens: 0, outputTokens: 181, reasoningTokens: 101, rawUsage: geminiRaw })).toEqual({
      inputText: 7542,
      inputAudio: 1458,
      cached: 0,
      output: 181,
      outputAudio: 80,
      thinking: 101,
    });
  });

  it("treats a text-only row as all text", () => {
    expect(usageBreakdown({ inputTokens: 5000, cachedInputTokens: 4000, outputTokens: 30, reasoningTokens: 0, rawUsage: JSON.stringify({ prompt_tokens: 9000, completion_tokens: 30 }) })).toMatchObject({
      inputText: 5000,
      inputAudio: 0,
      cached: 4000,
    });
  });
});

describe("sessions", () => {
  it("starts a new session after 30 minutes of silence, and at each voice call", () => {
    const sessions = splitSessions(
      [msg("u1", "user", 0), msg("a1", "assistant", 1), msg("u2", "user", 45), msg("a2", "assistant", 46), msg("u3", "user", 50), msg("a3", "assistant", 51)],
      [t(49, 30)],
    );
    expect(sessions.map((session) => [session.kind, session.messageIds])).toEqual([
      ["visit", ["u1", "a1"]],
      ["visit", ["u2", "a2"]],
      ["voice_call", ["u3", "a3"]],
    ]);
    // The call session starts when the call started, not at its first message.
    expect(sessions[2]!.start).toBe(t(49, 30).getTime());
  });
});

describe("tokens per message and session", () => {
  it("uses the exact link, estimates old rows by time, and keeps leftovers in their session", () => {
    const report = buildConversationObservability({
      messages: [msg("u1", "user", 0), msg("a1", "assistant", 0, 10), msg("u2", "user", 1), msg("a2", "assistant", 1, 20)],
      usage: [
        usage("r1", t(0, 8), "a1"), // linked
        usage("r2", t(1, 18), null), // old row, 2 s before a2
        usage("r3", t(5, 0), null, { costMicros: null }), // nothing near it
      ],
    });
    expect(report.byMessage.a1!.requests.map((request) => [request.id, request.attribution])).toEqual([["r1", "exact"]]);
    expect(report.byMessage.a2!.requests.map((request) => [request.id, request.attribution])).toEqual([["r2", "estimated"]]);
    expect(report.sessions[0]!.unattributed.map((request) => request.id)).toEqual(["r3"]);
    // Every request is counted once, in its session and in the total.
    expect(report.totals.requests).toBe(3);
    expect(report.sessions[0]!.totals.requests).toBe(3);
    expect(report.totals.costMicros).toBe(24_000);
    expect(report.totals.unpriced).toBe(1);
    expect(report.totals.inputAudio).toBe(3 * 1458);
    expect(report.tokensPerTurn).toBe(Math.round((3 * 9181) / 2));
  });
});
