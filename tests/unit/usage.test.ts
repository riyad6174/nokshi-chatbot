import { describe, expect, it } from "vitest";
import { computeCostMicros, type PricingRow } from "@/modules/ai/pricing.service";
import {
  addUsage,
  makeUsage,
  normalizeAnthropicUsage,
  normalizeOpenAiUsage,
  normalizeRealtimeUsage,
} from "@/modules/ai/usage";

describe("normalized usage", () => {
  it("splits cached OpenAI prompt tokens out of uncached input", () => {
    const usage = normalizeOpenAiUsage({
      prompt_tokens: 1000,
      completion_tokens: 200,
      total_tokens: 1200,
      prompt_tokens_details: { cached_tokens: 400 },
      completion_tokens_details: { reasoning_tokens: 50 },
    });

    expect(usage).toEqual({
      inputTokens: 600,
      outputTokens: 200,
      cachedInputTokens: 400,
      cacheWriteInputTokens: 0,
      reasoningTokens: 50,
      audioInputTokens: 0,
      cachedAudioInputTokens: 0,
      audioOutputTokens: 0,
      totalTokens: 1200,
    });
  });

  it("maps Anthropic cache reads and writes separately", () => {
    const usage = normalizeAnthropicUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 300,
      cache_creation_input_tokens: 200,
    });

    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 300,
      cacheWriteInputTokens: 200,
      reasoningTokens: 0,
      audioInputTokens: 0,
      cachedAudioInputTokens: 0,
      audioOutputTokens: 0,
      totalTokens: 650,
    });
  });

  it("accepts the realtime usage shape", () => {
    const usage = normalizeRealtimeUsage({
      input_tokens: 500,
      output_tokens: 120,
      input_token_details: { cached_tokens: 200 },
      output_token_details: { reasoning_tokens: 20 },
    });

    expect(usage).toMatchObject({
      inputTokens: 300,
      outputTokens: 120,
      cachedInputTokens: 200,
      reasoningTokens: 20,
      totalTokens: 620,
    });
  });

  it("returns null for empty or unknown payloads and adds usage without double counting", () => {
    expect(normalizeOpenAiUsage(null)).toBeNull();
    expect(normalizeAnthropicUsage({})).toBeNull();

    const total = addUsage(makeUsage({ inputTokens: 10, outputTokens: 4 }), makeUsage({ inputTokens: 5, cachedInputTokens: 2 }));
    expect(total).toEqual({
      inputTokens: 15,
      outputTokens: 4,
      cachedInputTokens: 2,
      cacheWriteInputTokens: 0,
      reasoningTokens: 0,
      audioInputTokens: 0,
      cachedAudioInputTokens: 0,
      audioOutputTokens: 0,
      totalTokens: 21,
    });
  });
});

describe("USD micro cost calculation", () => {
  const pricing: PricingRow = {
    id: "price-1",
    providerId: "openai-compatible",
    model: "test-model",
    inputPerMillion: 1,
    cachedInputPerMillion: 0.5,
    cacheWritePerMillion: 1.25,
    outputPerMillion: 2,
    audioInputPerMillion: null,
    cachedAudioInputPerMillion: null,
    audioOutputPerMillion: null,
    active: true,
    note: "",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  it("prices each disjoint token bucket at its own rate", () => {
    const cost = computeCostMicros(
      makeUsage({
        inputTokens: 1_000_000,
        cachedInputTokens: 500_000,
        cacheWriteInputTokens: 250_000,
        outputTokens: 100_000,
      }),
      pricing,
    );
    expect(cost).toBe(1_762_500);
  });

  it("does not add reasoning tokens again because they are part of output", () => {
    const withReasoning = computeCostMicros(makeUsage({ outputTokens: 1000, reasoningTokens: 800 }), pricing);
    const withoutReasoning = computeCostMicros(makeUsage({ outputTokens: 1000 }), pricing);
    expect(withReasoning).toBe(withoutReasoning);
  });

  it("prices Realtime audio at the audio rates and text at the text rates", () => {
    // A real gpt-realtime usage payload: 8,111 input (7,872 cached), 79 output.
    const usage = normalizeRealtimeUsage({
      total_tokens: 8190,
      input_tokens: 8111,
      output_tokens: 79,
      input_token_details: {
        text_tokens: 7503,
        audio_tokens: 608,
        cached_tokens: 7872,
        cached_tokens_details: { text_tokens: 7424, audio_tokens: 448 },
      },
      output_token_details: { text_tokens: 45, audio_tokens: 34 },
    })!;
    expect(usage).toMatchObject({
      inputTokens: 239,
      cachedInputTokens: 7872,
      outputTokens: 79,
      audioInputTokens: 160,
      cachedAudioInputTokens: 448,
      audioOutputTokens: 34,
    });
    const realtime: PricingRow = {
      ...pricing,
      inputPerMillion: 4,
      cachedInputPerMillion: 0.4,
      outputPerMillion: 16,
      audioInputPerMillion: 32,
      cachedAudioInputPerMillion: 0.4,
      audioOutputPerMillion: 64,
    };
    // Text: 79 in × 4 + 7,424 cached × 0.4 + 45 out × 16; audio: 160 × 32 + 448 × 0.4 + 34 × 64.
    expect(computeCostMicros(usage, realtime)).toBe(Math.round(79 * 4 + 7424 * 0.4 + 45 * 16 + 160 * 32 + 448 * 0.4 + 34 * 64));
    // Without audio rates, audio is priced like text (the old behaviour).
    expect(computeCostMicros(usage, { ...realtime, audioInputPerMillion: null, cachedAudioInputPerMillion: null, audioOutputPerMillion: null })).toBe(
      Math.round(239 * 4 + 7872 * 0.4 + 79 * 16),
    );
  });
});
