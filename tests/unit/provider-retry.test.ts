import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError, streamCompletion, type ProviderStreamEvent } from "@/modules/ai/provider";
import type { AiConfig } from "@/modules/ai/config";

const config: AiConfig = {
  providerId: "openai",
  kind: "openai-compatible",
  baseUrl: "https://ai.test/v1",
  apiKey: "test-key",
  model: "test-model",
  effort: "medium",
};

function sse(text: string): Response {
  const chunk = JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] });
  return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`, { status: 200 });
}

// Retry-After: 0 keeps the test fast; the delay logic is the same.
const failing = (status: number) => new Response("busy", { status, headers: { "retry-after": "0" } });

async function run(): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of streamCompletion({ config, messages: [{ role: "user", content: "hi" }], tools: [] })) {
    events.push(event);
  }
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI-compatible provider retries", () => {
  it("retries rate limits and server errors, then streams the reply", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(failing(429)).mockResolvedValueOnce(failing(503)).mockResolvedValueOnce(sse("Hello"));
    vi.stubGlobal("fetch", fetchMock);

    const events = await run();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(events[0]).toEqual({ type: "delta", text: "Hello" });
  });

  it("retries a dropped connection", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(sse("Hi"));
    vi.stubGlobal("fetch", fetchMock);

    const events = await run();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events[0]).toEqual({ type: "delta", text: "Hi" });
  });

  it("gives up after two retries", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => failing(503));
    vi.stubGlobal("fetch", fetchMock);

    await expect(run()).rejects.toBeInstanceOf(ProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry errors a retry can't fix", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad key", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(run()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("merges system messages into one for OpenAI-compatible servers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const stream = streamCompletion({
      config,
      messages: [
        { role: "system", content: "Stable", cache: true },
        { role: "system", content: "Per turn" },
        { role: "user", content: "hi" },
      ],
      tools: [],
      toolChoice: "none",
    });
    while (!(await stream.next()).done) {
      // drain
    }
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.messages).toEqual([
      { role: "system", content: "Stable\n\nPer turn" },
      { role: "user", content: "hi" },
    ]);
    expect(body.tool_choice).toBe("none");
  });
});
