import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@/lib/logging/logger";
import type { AiConfig } from "@/modules/ai/config";
import {
  ProviderError,
  type ProviderMessage,
  type ProviderStreamEvent,
  type ProviderTool,
  type ProviderToolCall,
} from "@/modules/ai/provider";

// Models that accept server-side refusal fallback in its "default" form on the Claude API.
// Claude Haiku 5.5 has no server-side fallback, so it is deliberately absent.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

export function createAnthropicClient(config: Pick<AiConfig, "apiKey" | "baseUrl">) {
  return new Anthropic({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    maxRetries: 2,
  });
}

export function toAnthropicTools(tools: ProviderTool[]): Anthropic.Beta.BetaTool[] {
  // Tool inputs here are a few ids and numbers, so eager input streaming buys nothing;
  // leaving it off keeps server-side schema validation on (we also validate with Zod).
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters as Anthropic.Beta.BetaTool.InputSchema,
  }));
}

/**
 * Converts the provider-neutral transcript into Messages API params.
 * - Assistant turns produced by this adapter carry their original content blocks in `raw`
 *   (thinking, text, tool_use) and are replayed unchanged, as the API requires.
 * - Consecutive tool results are grouped into one user message, so parallel tool calls stay parallel.
 * - Each system message becomes a system text block. Blocks marked `cache` get a cache breakpoint:
 *   tools render before system, so the tool definitions and the unchanging rules are cached together,
 *   while the per-turn part (cart, next step) after the breakpoint can change freely.
 */
export function toAnthropicMessages(messages: ProviderMessage[]): {
  system: Anthropic.Beta.BetaTextBlockParam[];
  messages: Anthropic.Beta.BetaMessageParam[];
} {
  const system: Anthropic.Beta.BetaTextBlockParam[] = messages
    .filter((message): message is Extract<ProviderMessage, { role: "system" }> => message.role === "system")
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      type: "text",
      text: message.content,
      ...(message.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));

  const output: Anthropic.Beta.BetaMessageParam[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "tool") {
      const block: Anthropic.Beta.BetaToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: message.tool_call_id,
        content: message.content,
        ...(message.isError ? { is_error: true } : {}),
      };
      const previous = output[output.length - 1];
      const previousIsToolResults =
        previous?.role === "user" &&
        Array.isArray(previous.content) &&
        previous.content.every((part) => part.type === "tool_result");
      if (previous && previousIsToolResults) {
        (previous.content as Anthropic.Beta.BetaContentBlockParam[]).push(block);
      } else {
        output.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (message.role === "assistant") {
      if (Array.isArray(message.raw)) {
        output.push({ role: "assistant", content: message.raw as Anthropic.Beta.BetaContentBlockParam[] });
      } else if (message.content) {
        output.push({ role: "assistant", content: message.content });
      }
      continue;
    }

    if (Array.isArray(message.content)) {
      output.push({
        role: "user",
        content: message.content.map((part): Anthropic.Beta.BetaContentBlockParam =>
          part.type === "text"
            ? { type: "text", text: part.text }
            : part.type === "image"
              ? {
                  type: "image",
                  source: { type: "base64", media_type: part.mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: part.data },
                }
              : { type: "document", source: { type: "base64", media_type: "application/pdf", data: part.data } },
        ),
      });
      continue;
    }
    output.push({ role: "user", content: message.content });
  }

  return { system, messages: output };
}

export async function* streamAnthropic(input: {
  config: AiConfig;
  messages: ProviderMessage[];
  tools: ProviderTool[];
  signal?: AbortSignal;
  toolChoice?: "auto" | "none";
}): AsyncGenerator<ProviderStreamEvent> {
  const client = createAnthropicClient(input.config);
  const { system, messages } = toAnthropicMessages(input.messages);
  const useFallback = !input.config.baseUrl && FALLBACK_MODELS.has(input.config.model);

  // Thinking is left at its default (adaptive on current models); effort is set explicitly
  // because some models default to a different level. No temperature: the API rejects it.
  const stream = client.beta.messages.stream(
    {
      model: input.config.model,
      max_tokens: 64000,
      ...(system.length > 0 ? { system } : {}),
      messages,
      tools: toAnthropicTools(input.tools),
      // Changing tool_choice between rounds keeps the tools + system cache intact.
      tool_choice: { type: input.toolChoice ?? "auto" },
      output_config: { effort: input.config.effort },
      ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    },
    { signal: input.signal },
  );

  let message: Anthropic.Beta.BetaMessage;
  try {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
        yield { type: "delta", text: event.delta.text };
      }
    }
    message = await stream.finalMessage();
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      logger.error("ai.provider_error", { provider: "anthropic", status: error.status, message: error.message.slice(0, 300) });
      throw new ProviderError("The AI provider could not complete the request.", error.status);
    }
    throw error;
  }

  if (message.stop_reason === "refusal") {
    // The whole fallback chain declined. Never run tools from a refused turn.
    logger.warn("ai.refusal", { model: message.model, category: message.stop_details?.category ?? null });
    yield { type: "done", finishReason: "refusal", toolCalls: [], raw: message.content };
    return;
  }

  const toolCalls: ProviderToolCall[] = message.content
    .filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use")
    .map((block) => ({
      id: block.id,
      type: "function",
      function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
    }));

  if (message.stop_reason === "max_tokens" && toolCalls.length > 0) {
    // A tool input cut off at max_tokens may still parse; don't run it.
    throw new ProviderError("The AI reply was cut off before a tool call finished.");
  }

  yield { type: "done", finishReason: message.stop_reason, toolCalls, raw: message.content };
}

/** Cheap credential + model check: no tokens are generated. */
export async function checkAnthropicConnection(config: Pick<AiConfig, "apiKey" | "baseUrl" | "model">) {
  const client = createAnthropicClient(config);
  const model = await client.models.retrieve(config.model);
  return { model: model.id, displayName: model.display_name };
}

export async function listAnthropicModels(config: Pick<AiConfig, "apiKey" | "baseUrl">): Promise<string[]> {
  const client = createAnthropicClient(config);
  const ids: string[] = [];
  for await (const model of client.models.list()) {
    ids.push(model.id);
    if (ids.length >= 100) break;
  }
  return ids;
}
