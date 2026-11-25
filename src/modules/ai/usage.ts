/**
 * Provider-neutral token usage.
 *
 * `inputTokens` intentionally means *uncached* input. Cached reads and cache writes are tracked
 * separately, because providers price them differently and some APIs include cached reads inside
 * their raw prompt-token total. Keeping the normalized fields disjoint makes cost calculation safe.
 */
export type NormalizedUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  /** A subset of output tokens; kept for visibility, never added to cost again. */
  reasoningTokens: number;
  /**
   * Audio subsets (OpenAI Realtime), priced at audio rates when the model has them:
   * `audioInputTokens` ⊆ inputTokens (uncached), `cachedAudioInputTokens` ⊆ cachedInputTokens,
   * `audioOutputTokens` ⊆ outputTokens. Never added to totals again.
   */
  audioInputTokens: number;
  cachedAudioInputTokens: number;
  audioOutputTokens: number;
  totalTokens: number;
};

export function emptyUsage(): NormalizedUsage {
  return makeUsage({});
}

function tokenCount(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function makeUsage(parts: Partial<Omit<NormalizedUsage, "totalTokens">>): NormalizedUsage {
  const usage = {
    inputTokens: tokenCount(parts.inputTokens),
    outputTokens: tokenCount(parts.outputTokens),
    cachedInputTokens: tokenCount(parts.cachedInputTokens),
    cacheWriteInputTokens: tokenCount(parts.cacheWriteInputTokens),
    reasoningTokens: tokenCount(parts.reasoningTokens),
  };
  return {
    ...usage,
    // Subsets can't exceed the totals they belong to (guards against odd provider payloads).
    audioInputTokens: Math.min(tokenCount(parts.audioInputTokens), usage.inputTokens),
    cachedAudioInputTokens: Math.min(tokenCount(parts.cachedAudioInputTokens), usage.cachedInputTokens),
    audioOutputTokens: Math.min(tokenCount(parts.audioOutputTokens), usage.outputTokens),
    totalTokens: usage.inputTokens + usage.outputTokens + usage.cachedInputTokens + usage.cacheWriteInputTokens,
  };
}

export function addUsage(left: NormalizedUsage, right: NormalizedUsage): NormalizedUsage {
  return makeUsage({
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    cacheWriteInputTokens: left.cacheWriteInputTokens + right.cacheWriteInputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    audioInputTokens: left.audioInputTokens + right.audioInputTokens,
    cachedAudioInputTokens: left.cachedAudioInputTokens + right.cachedAudioInputTokens,
    audioOutputTokens: left.audioOutputTokens + right.audioOutputTokens,
  });
}

/**
 * Audio token counts from an OpenAI usage payload (Realtime): uncached audio input, cached audio
 * input and audio output. Zeros for text-only payloads.
 */
export function audioTokensFromOpenAiUsage(raw: unknown) {
  const usage = record(raw);
  const inputDetails = record(usage.input_token_details ?? usage.prompt_tokens_details);
  const cachedDetails = record(inputDetails.cached_tokens_details);
  const outputDetails = record(usage.output_token_details ?? usage.completion_tokens_details);
  const audioIn = tokenCount(inputDetails.audio_tokens);
  const cachedAudioIn = Math.min(audioIn, tokenCount(cachedDetails.audio_tokens));
  return {
    audioInputTokens: audioIn - cachedAudioIn,
    cachedAudioInputTokens: cachedAudioIn,
    audioOutputTokens: tokenCount(outputDetails.audio_tokens),
  };
}

/**
 * OpenAI chat completions:
 * `prompt_tokens` includes cached reads, so the uncached portion is `prompt_tokens - cached_tokens`.
 * `completion_tokens` already includes reasoning tokens.
 */
export function normalizeOpenAiUsage(raw: unknown): NormalizedUsage | null {
  const usage = record(raw);
  if (Object.keys(usage).length === 0) return null;
  const prompt = tokenCount(usage.prompt_tokens ?? usage.input_tokens);
  if (prompt === 0 && tokenCount(usage.completion_tokens ?? usage.output_tokens) === 0) return null;
  const promptDetails = record(usage.prompt_tokens_details ?? usage.input_token_details);
  const completionDetails = record(usage.completion_tokens_details ?? usage.output_token_details);
  const cached = Math.min(prompt, tokenCount(promptDetails.cached_tokens));
  return makeUsage({
    inputTokens: prompt - cached,
    outputTokens: tokenCount(usage.completion_tokens ?? usage.output_tokens),
    cachedInputTokens: cached,
    reasoningTokens: tokenCount(completionDetails.reasoning_tokens),
    ...audioTokensFromOpenAiUsage(raw),
  });
}

/** Embeddings responses bill prompt tokens only. */
export function normalizeEmbeddingUsage(raw: unknown): NormalizedUsage | null {
  const usage = record(raw);
  const input = tokenCount(usage.prompt_tokens ?? usage.input_tokens ?? usage.total_tokens);
  return input > 0 ? makeUsage({ inputTokens: input }) : null;
}

/**
 * OpenAI Realtime responses use `input_tokens` / `output_tokens`, with cached reads in
 * `input_token_details.cached_tokens`. Some older payloads use the chat-completions field names,
 * so both shapes are accepted.
 */
export function normalizeRealtimeUsage(raw: unknown): NormalizedUsage | null {
  return normalizeOpenAiUsage(raw);
}

/**
 * Anthropic Messages API. `input_tokens` is already the uncached input; cache reads and writes are
 * separate fields. Thinking tokens are included in `output_tokens`.
 */
export function normalizeAnthropicUsage(raw: unknown): NormalizedUsage | null {
  const usage = record(raw);
  if (Object.keys(usage).length === 0) return null;
  const input = tokenCount(usage.input_tokens);
  const output = tokenCount(usage.output_tokens);
  const cached = tokenCount(usage.cache_read_input_tokens);
  const cacheWrite = tokenCount(usage.cache_creation_input_tokens);
  if (input === 0 && output === 0 && cached === 0 && cacheWrite === 0) return null;
  return makeUsage({
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: cached,
    cacheWriteInputTokens: cacheWrite,
  });
}

/** One request's tokens split by kind, for the inbox observability report. */
export type UsageBreakdown = {
  /** Uncached input, text part. */
  inputText: number;
  /** Uncached input, audio part (live voice). */
  inputAudio: number;
  /** Cached input (all modalities). */
  cached: number;
  /** Output incl. thinking. */
  output: number;
  /** Audio part of the output (spoken reply). */
  outputAudio: number;
  /** Thinking part of the output. */
  thinking: number;
};

function modalityTotal(details: unknown, modality: string): number {
  if (!Array.isArray(details)) return 0;
  return details.reduce((sum, entry) => {
    const item = record(entry);
    return sum + (item.modality === modality ? tokenCount(item.tokenCount) : 0);
  }, 0);
}

/**
 * Splits a stored usage row into text/audio/cached/output/thinking using its raw provider payload
 * (Gemini `usageMetadata` by modality, or OpenAI `*_token_details`). Rows without audio detail are all text.
 */
export function usageBreakdown(row: { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number; rawUsage?: string | null }): UsageBreakdown {
  let raw: Record<string, unknown> = {};
  try {
    raw = record(JSON.parse(row.rawUsage || "{}"));
  } catch {
    raw = {};
  }
  let audioIn = 0;
  let audioOut = 0;
  if ("promptTokenCount" in raw || "promptTokensDetails" in raw) {
    const promptAudio = modalityTotal(raw.promptTokensDetails, "AUDIO");
    const cachedAudio = Math.min(promptAudio, modalityTotal(raw.cacheTokensDetails, "AUDIO"));
    audioIn = promptAudio - cachedAudio;
    audioOut = modalityTotal(raw.responseTokensDetails ?? raw.candidatesTokensDetails, "AUDIO");
  } else if (Object.keys(raw).length > 0) {
    const openAi = audioTokensFromOpenAiUsage(raw);
    audioIn = openAi.audioInputTokens;
    audioOut = openAi.audioOutputTokens;
  }
  const inputAudio = Math.min(audioIn, row.inputTokens);
  return {
    inputText: row.inputTokens - inputAudio,
    inputAudio,
    cached: row.cachedInputTokens,
    output: row.outputTokens,
    outputAudio: Math.min(audioOut, row.outputTokens),
    thinking: Math.min(row.reasoningTokens, row.outputTokens),
  };
}
