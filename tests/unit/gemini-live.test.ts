import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto/secrets";
import { streamCompletion } from "@/modules/ai/provider";
import { geminiLiveSetup, normalizeGeminiUsage } from "@/modules/realtime/gemini-live.service";
import { geminiLiveApiKey, voiceEngine } from "@/modules/realtime/realtime.service";

// Only the fields the voice functions read; the rest of ChatbotSettings doesn't matter here.
function store(fields: Record<string, unknown>) {
  return { settings: { provider: "openai-compatible", model: "", aiBaseUrl: "", aiApiKeyEncrypted: "", aiApiKeyLast4: "", aiEffort: "medium", ...fields } } as never;
}

const geminiText = { provider: "gemini", model: "gemini-3.8-flash", aiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", aiApiKeyEncrypted: encryptSecret("AIza-text-key") };

describe("voice engine choice", () => {
  it("uses the Gemini text key for Gemini Live voice when no voice key is saved", () => {
    expect(geminiLiveApiKey(store({ ...geminiText, voiceEngine: "gemini" }))).toBe("AIza-text-key");
    expect(voiceEngine(store({ ...geminiText, voiceEngine: "gemini" }))).toBe("gemini");
  });

  it("prefers a saved Gemini voice key", () => {
    expect(geminiLiveApiKey(store({ ...geminiText, geminiApiKeyEncrypted: encryptSecret("AIza-voice") }))).toBe("AIza-voice");
  });

  it("falls back to another engine instead of leaving customers without voice", () => {
    // Gemini chosen but only an OpenAI voice key: OpenAI Realtime.
    expect(voiceEngine(store({ voiceEngine: "gemini", realtimeApiKeyEncrypted: encryptSecret("sk-voice") }))).toBe("realtime");
    // OpenAI chosen but only a Gemini key: Gemini Live.
    expect(voiceEngine(store({ ...geminiText, voiceEngine: "realtime" }))).toBe("gemini");
    // No live key at all: the classic engine.
    expect(voiceEngine(store({ voiceEngine: "gemini" }))).toBe("cascade");
    // Classic chosen: stays classic even with keys.
    expect(voiceEngine(store({ ...geminiText, voiceEngine: "cascade" }))).toBe("cascade");
  });
});

describe("Gemini Live setup", () => {
  it("locks audio replies, transcripts, our tools and the resume handle into the setup", () => {
    const setup = geminiLiveSetup({ instructions: "Be nice.", model: "gemini-3.8-live", voice: "Kore", resumeHandle: "h1" });
    expect(setup.model).toBe("models/gemini-3.8-live");
    expect(setup.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore");
    expect(setup.systemInstruction.parts[0]!.text).toBe("Be nice.");
    expect(setup.inputAudioTranscription).toEqual({ languageCodes: ["bn-BD", "en-US"] });
    // A turn needs sustained speech: clicks, noise and echo kept starting turns that cut replies off.
    expect(setup.realtimeInputConfig.automaticActivityDetection.startOfSpeechSensitivity).toBe("START_SENSITIVITY_LOW");
    expect(geminiLiveSetup({ instructions: "x", model: "m", voice: "v", language: "en" }).inputAudioTranscription.languageCodes[0]).toBe("en-US");
    expect(setup.sessionResumption).toEqual({ handle: "h1" });
    const names = setup.tools[0]!.functionDeclarations.map((tool) => tool.name);
    expect(names).toContain("search_products");
    expect(names).toContain("add_to_cart");
    expect(setup.tools[0]!.functionDeclarations[0]!.parametersJsonSchema).toMatchObject({ type: "object" });
  });
});

describe("Gemini usage", () => {
  it("separates cached, audio and thinking tokens", () => {
    const usage = normalizeGeminiUsage({
      promptTokenCount: 1000,
      cachedContentTokenCount: 600,
      responseTokenCount: 200,
      thoughtsTokenCount: 50,
      promptTokensDetails: [{ modality: "TEXT", tokenCount: 700 }, { modality: "AUDIO", tokenCount: 300 }],
      cacheTokensDetails: [{ modality: "AUDIO", tokenCount: 100 }],
      responseTokensDetails: [{ modality: "AUDIO", tokenCount: 180 }],
    });
    expect(usage).toMatchObject({
      inputTokens: 400,
      cachedInputTokens: 600,
      outputTokens: 250,
      reasoningTokens: 50,
      audioInputTokens: 200,
      cachedAudioInputTokens: 100,
      audioOutputTokens: 180,
    });
    expect(normalizeGeminiUsage({})).toBeNull();
  });
});

describe("Gemini text requests", () => {
  it("sends Gemini's thought signature back with its tool call", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const signature = { google: { thought_signature: "sig-123" } };
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const chunk = { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "search_products", arguments: "{}" }, extra_content: signature }] }, finish_reason: "tool_calls" }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { status: 200 });
    });
    const config = { providerId: "gemini", kind: "openai-compatible" as const, baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: "k", model: "gemini-3.8-flash", effort: "low" as const };
    let done: { toolCalls: Array<{ extra_content?: unknown }> } | null = null;
    for await (const event of streamCompletion({ config, messages: [{ role: "user", content: "bags" }], tools: [] })) {
      if (event.type === "done") done = event;
    }
    expect(done!.toolCalls[0]!.extra_content).toEqual(signature);
    // The next round replays the call with its signature.
    for await (const _event of streamCompletion({
      config,
      messages: [
        { role: "user", content: "bags" },
        { role: "assistant", content: null, tool_calls: done!.toolCalls as never },
        { role: "tool", content: "{}", tool_call_id: "c1", name: "search_products" },
      ],
      tools: [],
    })) void _event;
    const replayed = (bodies[1]!.messages as Array<{ tool_calls?: Array<{ extra_content?: unknown }> }>)[1]!;
    expect(replayed.tool_calls![0]!.extra_content).toEqual(signature);
  });

  it("retries a rejected Gemini request once without the optional fields, and reports the reason", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify([{ error: { message: "Invalid JSON payload: unknown name reasoning_effort" } }]), { status: 400 });
    });
    const config = { providerId: "gemini", kind: "openai-compatible" as const, baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: "k", model: "gemini-3.8-flash", effort: "low" as const };
    const run = async () => {
      for await (const _event of streamCompletion({ config, messages: [{ role: "user", content: "hi" }], tools: [] })) void _event;
    };
    await expect(run()).rejects.toThrow(/400: Invalid JSON payload: unknown name reasoning_effort/);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.reasoning_effort).toBe("low");
    expect(bodies[1]!.reasoning_effort).toBeUndefined();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("sends a thinking level and usage request, and no reply cap that thinking could eat", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response("data: [DONE]\n\n", { status: 200 });
    });
    const events = streamCompletion({
      config: { providerId: "gemini", kind: "openai-compatible", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: "k", model: "gemini-3.8-flash", effort: "low" },
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      maxOutputTokens: 350,
      temperature: 0.2,
    });
    for await (const _event of events) void _event;
    expect(body.reasoning_effort).toBe("low");
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });
});
