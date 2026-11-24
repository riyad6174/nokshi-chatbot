import { logger } from "@/lib/logging/logger";
import type { AiConfig } from "@/modules/ai/config";
import { normalizeOpenAiUsage, type NormalizedUsage } from "@/modules/ai/usage";

export type ProviderToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  /**
   * Provider data to send back unchanged with this call. Gemini 3 puts its thought signature here
   * (extra_content.google.thought_signature) and rejects the next request without it.
   */
  extra_content?: unknown;
};

/** Parts of a customer message beyond text: attached images and PDFs (base64). */
export type UserContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mime: string; data: string; name?: string }
  | { type: "document"; mime: "application/pdf"; data: string; name?: string };

export type ProviderMessage =
  /** `cache`: this block is the same on every turn, so providers that support prompt caching may cache up to it. */
  | { role: "system"; content: string; cache?: boolean }
  | { role: "user"; content: string | UserContentPart[] }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: ProviderToolCall[];
      /** Provider-native content blocks to replay unchanged (Anthropic thinking + tool_use). */
      raw?: unknown;
    }
  | { role: "tool"; content: string; tool_call_id: string; name?: string; isError?: boolean };

export type ProviderTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ProviderStreamEvent =
  | { type: "delta"; text: string }
  | {
      type: "done";
      finishReason: string | null;
      toolCalls: ProviderToolCall[];
      raw?: unknown;
      /** Normalized provider usage for this response when the API reports it. */
      usage?: NormalizedUsage;
      /** Provider-native usage payload, kept for auditability. */
      rawUsage?: unknown;
      providerId?: string;
      model?: string;
      providerRequestId?: string;
    };

/** The provider's own error message from a JSON error body (for logs and the turn log), short. */
function providerErrorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const message = (first as { error?: { message?: unknown } } | null)?.error?.message;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 300);
  } catch {
    // Not JSON.
  }
  return body.trim().slice(0, 300) || "no details";
}

export class ProviderError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

export type StreamCompletionInput = {
  config: AiConfig;
  messages: ProviderMessage[];
  tools: ProviderTool[];
  signal?: AbortSignal;
  temperature?: number;
  /** "none": the model must answer in text (the tools stay defined so earlier tool calls remain valid). */
  toolChoice?: "auto" | "none";
  /** Upper bound on the reply (and tool arguments) in one round; a guard against runaway output. */
  maxOutputTokens?: number;
  /** Groups requests that share the same prompt prefix, for OpenAI's prompt cache. */
  cacheKey?: string;
};

/**
 * OpenAI reasoning models (o1/o3/o4…, gpt-5…) reject `max_tokens` and a custom temperature, and spend
 * part of their output budget thinking, so they get neither.
 */
function isReasoningModel(model: string): boolean {
  const name = model.split("/").pop()?.toLowerCase() ?? "";
  return /^(o\d|gpt-5)/.test(name);
}

function isOpenAiApi(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "api.openai.com";
  } catch {
    return false;
  }
}

function isGeminiApi(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "generativelanguage.googleapis.com";
  } catch {
    return false;
  }
}

/**
 * Gemini thinking depth from the admin "effort" setting. Thinking can't be turned off on every Gemini
 * model, so the lowest setting is "low": short thinking, the fastest replies and the fewest tokens.
 */
function geminiReasoningEffort(effort: AiConfig["effort"]): "low" | "medium" | "high" {
  return effort === "low" ? "low" : effort === "medium" ? "medium" : "high";
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  return timeout;
}

async function* readSse(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError("The AI provider returned an empty response.", response.status);
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of rawEvent.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data:")) {
            yield trimmed.slice(5).trim();
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) {
      for (const line of buffer.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) yield trimmed.slice(5).trim();
      }
    }
  } finally {
    reader.releaseLock();
  }
}

type AccumulatedToolCall = { id?: string; name: string; arguments: string; index: number; extra?: unknown };

function openAiHeaders(config: Pick<AiConfig, "apiKey">): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  };
}

function toOpenAiMessages(messages: ProviderMessage[]) {
  // One system message: some OpenAI-compatible servers reject or ignore a second one.
  const system = messages
    .filter((message): message is Extract<ProviderMessage, { role: "system" }> => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const rest = messages.filter((message) => message.role !== "system");

  // Strip fields that only the Anthropic adapter understands.
  const converted = rest.map((message) => {
    if (message.role === "assistant") {
      return { role: message.role, content: message.content, ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) };
    }
    if (message.role === "tool") {
      return { role: message.role, content: message.content, tool_call_id: message.tool_call_id, name: message.name };
    }
    if (message.role === "user" && Array.isArray(message.content)) {
      return {
        role: "user" as const,
        content: message.content.map((part) =>
          part.type === "text"
            ? { type: "text", text: part.text }
            : part.type === "image"
              ? { type: "image_url", image_url: { url: `data:${part.mime};base64,${part.data}` } }
              : { type: "file", file: { filename: part.name || "document.pdf", file_data: `data:application/pdf;base64,${part.data}` } },
        ),
      };
    }
    return message;
  });
  return system ? [{ role: "system" as const, content: system }, ...converted] : converted;
}

const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 8_000;

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** Retry-After in seconds or as an HTTP date; otherwise exponential backoff with jitter. */
function retryDelayMs(response: Response | null, attempt: number): number {
  const header = response?.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
    if (Number.isFinite(ms)) return Math.min(Math.max(ms, 0), MAX_RETRY_DELAY_MS);
  }
  return Math.min(500 * 2 ** attempt + Math.random() * 250, MAX_RETRY_DELAY_MS);
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Retries rate limits, overloads, server errors and dropped connections before any of the reply has
 * streamed, so a brief provider hiccup doesn't count as a miss. The caller's signal (including its
 * timeout) bounds the total time across attempts.
 */
async function fetchWithRetry(url: string, init: RequestInit & { signal: AbortSignal }): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response | null = null;
    try {
      response = await fetch(url, init);
      if (response.ok || !isRetryableStatus(response.status) || attempt >= MAX_RETRIES) return response;
      // A used-up daily/plan quota doesn't come back in seconds: return it right away (the caller can
      // switch to a backup model) instead of waiting through the retries.
      if (response.status === 429) {
        const body = await response.text().catch(() => "");
        if (/exceeded your current quota|PerDay|RESOURCE_EXHAUSTED|insufficient_quota/i.test(body)) {
          return new Response(body, { status: response.status, headers: response.headers });
        }
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
    } catch (error) {
      if (init.signal.aborted || attempt >= MAX_RETRIES) throw error;
    }
    logger.warn("ai.provider_retry", { attempt: attempt + 1, status: response?.status ?? null });
    await wait(retryDelayMs(response, attempt), init.signal);
  }
}

async function* streamOpenAiCompatible(input: StreamCompletionInput): AsyncGenerator<ProviderStreamEvent> {
  const { config } = input;
  const gemini = isGeminiApi(config.baseUrl);
  const reasoning = isReasoningModel(config.model);
  // Gemini: thinking tokens count against max_tokens (a tight cap cuts replies off, or leaves them
  // empty), and Gemini 3+ models are tuned for their default temperature, so neither is sent.
  const geminiModern = gemini && /gemini-([3-9]|\d{2})/.test(config.model);
  const request = (minimal: boolean) =>
    fetchWithRetry(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: openAiHeaders(config),
    body: JSON.stringify({
      model: config.model,
      messages: toOpenAiMessages(input.messages),
      tools: input.tools,
      tool_choice: input.toolChoice ?? "auto",
      ...(reasoning || geminiModern ? {} : { temperature: input.temperature ?? 0.2 }),
      ...(!reasoning && !gemini && input.maxOutputTokens ? { max_tokens: input.maxOutputTokens } : {}),
      ...(gemini && !minimal ? { reasoning_effort: geminiReasoningEffort(config.effort), stream_options: { include_usage: true } } : {}),
      // Reasoning models: shallow reasoning is plenty for shop chat, and the cap (which includes
      // reasoning tokens) stops a runaway reply. Only OpenAI's own API is known to take these.
      ...(reasoning && isOpenAiApi(config.baseUrl) ? { reasoning_effort: "low", max_completion_tokens: 4000 } : {}),
      // Only OpenAI's own API knows this field; other compatible servers may reject unknown fields.
      ...(input.cacheKey && isOpenAiApi(config.baseUrl) ? { prompt_cache_key: input.cacheKey } : {}),
      // Only OpenAI's own API is known to accept this field. Usage from other compatible
      // providers is recorded when they return it, but the request stays compatible when they don't.
      ...(isOpenAiApi(config.baseUrl) ? { stream_options: { include_usage: true } } : {}),
      stream: true,
    }),
    signal: combineSignals(input.signal, 45_000),
  });

  let response = await request(false);
  // Gemini rejecting a request outright: try once more without the optional Gemini-only fields
  // (thinking level, usage reporting), which some models or API versions don't accept.
  if (!response.ok && response.status === 400 && gemini) {
    const body = await response.text().catch(() => "");
    logger.warn("ai.provider_retry_minimal", { status: response.status, body: body.slice(0, 500) });
    response = await request(true);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.error("ai.provider_error", { status: response.status, body: body.slice(0, 500) });
    throw new ProviderError(`The AI provider returned ${response.status}: ${providerErrorDetail(body)}`, response.status);
  }

  const providerRequestId = response.headers.get("x-request-id") ?? undefined;
  const toolCalls = new Map<number, AccumulatedToolCall>();
  let finishReason: string | null = null;
  let finalUsage: NormalizedUsage | null = null;
  let finalRawUsage: unknown;

  for await (const data of readSse(response)) {
    if (data === "[DONE]") break;
    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }

    if (parsed.error) {
      logger.error("ai.provider_stream_error", { message: String(parsed.error?.message || "").slice(0, 300) });
      throw new ProviderError("The AI provider returned an error.");
    }

    // The usage chunk arrives last and has an empty choices array, so read it before the
    // choice guard below. Some compatible providers include usage on a normal chunk instead.
    const usage = normalizeOpenAiUsage(parsed.usage);
    if (usage) {
      finalUsage = usage;
      finalRawUsage = parsed.usage;
    }

    const choice = parsed.choices?.[0];
    if (!choice) continue;

    const text: string | undefined = choice.delta?.content;
    if (text) yield { type: "delta", text };

    const deltaToolCalls = choice.delta?.tool_calls;
    if (Array.isArray(deltaToolCalls)) {
      for (const call of deltaToolCalls) {
        const index = typeof call.index === "number" ? call.index : toolCalls.size;
        const existing: AccumulatedToolCall = toolCalls.get(index) ?? { name: "", arguments: "", index };
        if (call.id) existing.id = call.id;
        if (call.function?.name) existing.name += call.function.name;
        if (call.function?.arguments) existing.arguments += call.function.arguments;
        if (call.extra_content) existing.extra = call.extra_content;
        toolCalls.set(index, existing);
      }
    }

    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  const completed: ProviderToolCall[] = [...toolCalls.values()]
    .filter((call) => call.name)
    .sort((a, b) => a.index - b.index)
    .map((call, position) => ({
      id: call.id || `call_${call.index}_${position}`,
      type: "function",
      function: { name: call.name, arguments: call.arguments || "{}" },
      ...(call.extra !== undefined ? { extra_content: call.extra } : {}),
    }));

  yield {
    type: "done",
    finishReason,
    toolCalls: completed,
    ...(finalUsage ? { usage: finalUsage } : {}),
    ...(finalRawUsage !== undefined ? { rawUsage: finalRawUsage } : {}),
    providerId: config.providerId,
    model: config.model,
    providerRequestId,
  };
}

export async function* streamCompletion(input: StreamCompletionInput): AsyncGenerator<ProviderStreamEvent> {
  if (input.config.kind === "anthropic") {
    const { streamAnthropic } = await import("@/modules/ai/anthropic.provider");
    yield* streamAnthropic({
      config: input.config,
      messages: input.messages,
      tools: input.tools,
      toolChoice: input.toolChoice,
      // Claude turns with thinking can take longer than a plain completion.
      signal: combineSignals(input.signal, 120_000),
    });
    return;
  }
  // Out of quota or overloaded before anything streamed: try the backup model once (if one is set).
  const fallback = input.config.fallbackModel;
  let streamed = false;
  try {
    for await (const event of streamOpenAiCompatible(input)) {
      streamed = true;
      yield event;
    }
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : undefined;
    if (streamed || !fallback || fallback === input.config.model || (status !== 429 && status !== 503)) throw error;
    logger.warn("ai.provider_fallback", { model: input.config.model, fallback, status });
    yield* streamOpenAiCompatible({ ...input, config: { ...input.config, model: fallback } });
  }
}

/** Dashboard "Test connection" for OpenAI-compatible APIs: lists models without generating tokens. */
export async function listOpenAiCompatibleModels(config: Pick<AiConfig, "apiKey" | "baseUrl">): Promise<string[]> {
  const response = await fetch(`${config.baseUrl}/models`, {
    headers: openAiHeaders(config),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new ProviderError("The provider rejected the request.", response.status);
  const body = (await response.json().catch(() => null)) as { data?: Array<{ id?: unknown }> } | null;
  return (body?.data ?? [])
    // Gemini lists ids as "models/gemini-…"; requests take the bare name.
    .map((entry) => (typeof entry.id === "string" ? entry.id.replace(/^models\//, "") : null))
    .filter((id): id is string => Boolean(id))
    .slice(0, 200);
}
