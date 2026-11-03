import { logger } from "@/lib/logging/logger";
import type { AiConfig } from "@/modules/ai/config";

export type ProviderToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ProviderMessage =
  /** `cache`: this block is the same on every turn, so providers that support prompt caching may cache up to it. */
  | { role: "system"; content: string; cache?: boolean }
  | { role: "user"; content: string }
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
  | { type: "done"; finishReason: string | null; toolCalls: ProviderToolCall[]; raw?: unknown };

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
};

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

type AccumulatedToolCall = { id?: string; name: string; arguments: string; index: number };

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
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      if (init.signal.aborted || attempt >= MAX_RETRIES) throw error;
    }
    logger.warn("ai.provider_retry", { attempt: attempt + 1, status: response?.status ?? null });
    await wait(retryDelayMs(response, attempt), init.signal);
  }
}

async function* streamOpenAiCompatible(input: StreamCompletionInput): AsyncGenerator<ProviderStreamEvent> {
  const { config } = input;
  const response = await fetchWithRetry(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: openAiHeaders(config),
    body: JSON.stringify({
      model: config.model,
      messages: toOpenAiMessages(input.messages),
      tools: input.tools,
      tool_choice: input.toolChoice ?? "auto",
      temperature: input.temperature ?? 0.2,
      stream: true,
    }),
    signal: combineSignals(input.signal, 45_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.error("ai.provider_error", { status: response.status, body: body.slice(0, 500) });
    throw new ProviderError("The AI provider could not be reached.", response.status);
  }

  const toolCalls = new Map<number, AccumulatedToolCall>();
  let finishReason: string | null = null;

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
    }));

  yield { type: "done", finishReason, toolCalls: completed };
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
  yield* streamOpenAiCompatible(input);
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
    .map((entry) => (typeof entry.id === "string" ? entry.id : null))
    .filter((id): id is string => Boolean(id))
    .slice(0, 200);
}
