import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { getLiveCallTools } from "@/modules/ai/tools";
import { makeUsage, type NormalizedUsage } from "@/modules/ai/usage";
import type { SessionContext } from "@/modules/conversations/session.service";
import { savedDetailsForVisitor } from "@/modules/customers/profile.service";
import {
  geminiLiveApiKey,
  openerInstruction,
  realtimeInstructions,
  RealtimeError,
  realtimeSettings,
  storeLanguage,
} from "@/modules/realtime/realtime.service";
import type { ReplyLanguagePreference } from "@/modules/sales/config";
import type { StoreWithSettings } from "@/modules/stores/store.service";

// Live voice over the Gemini Live API: one streaming model hears the customer, decides and speaks,
// over a WebSocket straight from the browser. Like the OpenAI Realtime engine, the server keeps the
// important parts: it builds the instructions and tools, locks them into a short-lived single-use
// token (the store's key never reaches the browser, and the browser can't change the prompt), and
// runs every tool against the database through /api/widget/voice/realtime/tool.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** The WebSocket the browser opens with the token (ephemeral tokens only work on v1beta). */
export const GEMINI_LIVE_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

/** Tokens can start a call for this long after they are minted (pre-fetched before the tap). */
const NEW_SESSION_WINDOW_MS = 10 * 60_000;

/**
 * All 30 prebuilt Gemini voices (every Gemini Live model can use any of them; each speaks every
 * supported language). Any other name can still be typed in the dashboard.
 */
export const GEMINI_VOICES: Array<{ id: string; label: string; group: string }> = [
  { id: "Kore", label: "Kore (firm)", group: "Female" },
  { id: "Aoede", label: "Aoede (breezy)", group: "Female" },
  { id: "Leda", label: "Leda (youthful)", group: "Female" },
  { id: "Sulafat", label: "Sulafat (warm)", group: "Female" },
  { id: "Achernar", label: "Achernar (soft)", group: "Female" },
  { id: "Zephyr", label: "Zephyr (bright)", group: "Female" },
  { id: "Autonoe", label: "Autonoe (bright)", group: "Female" },
  { id: "Callirrhoe", label: "Callirrhoe (easy-going)", group: "Female" },
  { id: "Despina", label: "Despina (smooth)", group: "Female" },
  { id: "Erinome", label: "Erinome (clear)", group: "Female" },
  { id: "Laomedeia", label: "Laomedeia (upbeat)", group: "Female" },
  { id: "Gacrux", label: "Gacrux (mature)", group: "Female" },
  { id: "Pulcherrima", label: "Pulcherrima (forward)", group: "Female" },
  { id: "Vindemiatrix", label: "Vindemiatrix (gentle)", group: "Female" },
  { id: "Puck", label: "Puck (upbeat)", group: "Male" },
  { id: "Charon", label: "Charon (informative)", group: "Male" },
  { id: "Orus", label: "Orus (firm)", group: "Male" },
  { id: "Fenrir", label: "Fenrir (excitable)", group: "Male" },
  { id: "Achird", label: "Achird (friendly)", group: "Male" },
  { id: "Enceladus", label: "Enceladus (breathy)", group: "Male" },
  { id: "Iapetus", label: "Iapetus (clear)", group: "Male" },
  { id: "Umbriel", label: "Umbriel (easy-going)", group: "Male" },
  { id: "Algieba", label: "Algieba (smooth)", group: "Male" },
  { id: "Algenib", label: "Algenib (gravelly)", group: "Male" },
  { id: "Rasalgethi", label: "Rasalgethi (informative)", group: "Male" },
  { id: "Alnilam", label: "Alnilam (firm)", group: "Male" },
  { id: "Schedar", label: "Schedar (even)", group: "Male" },
  { id: "Zubenelgenubi", label: "Zubenelgenubi (casual)", group: "Male" },
  { id: "Sadachbia", label: "Sadachbia (lively)", group: "Male" },
  { id: "Sadaltager", label: "Sadaltager (knowledgeable)", group: "Male" },
];

export function geminiLiveSettings(store: Pick<StoreWithSettings, "settings">) {
  const settings = store.settings;
  return {
    model: (settings?.geminiLiveModel?.trim() || env.GEMINI_LIVE_MODEL).replace(/^models\//, ""),
    voice: settings?.geminiLiveVoice?.trim() || env.GEMINI_LIVE_VOICE,
    style: realtimeSettings(store).style,
  };
}

/** Our chat-completions tool schemas as Gemini function declarations (full JSON Schema). */
export function geminiFunctionDeclarations(enabledFeatures?: string | null) {
  return getLiveCallTools(enabledFeatures).map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parametersJsonSchema: tool.function.parameters,
  }));
}

/** Extra rules for Gemini Live: the parts of a call that most often went wrong. */
// The rest of the call rules are in the shared instructions; this is the one that broke without
// emphasis on a call (products described but never shown).
const GEMINI_CALL_RULES = `TOOLS ON A CALL (most important): when they ask to see or find products ("দেখান", "কি কি আছে", "show me"), call search_products in this same turn before saying anything about them: cards only appear when you call it. Never describe or promise products, cart changes or orders without the tool's result. Product questions ("what's the difference", "which is better", features): look them up with compare_products or get_product_details first, never from memory.`;

type SetupInput = {
  instructions: string;
  enabledFeatures?: string | null;
  model: string;
  voice: string;
  resumeHandle?: string;
  /** The store's language (Admin → AI Sales & Engagement): which languages to expect when transcribing. */
  language?: ReplyLanguagePreference;
};

/** Languages the customer speaks, for transcription. Without a hint, noise came back as Spanish, French or Hindi. */
function transcriptionLanguages(language: ReplyLanguagePreference = "auto"): string[] {
  return language === "en" ? ["en-US", "bn-BD"] : ["bn-BD", "en-US"];
}

/** The BidiGenerateContentSetup for a call: audio out, transcripts both ways, our tools and VAD tuning. */
export function geminiLiveSetup(input: SetupInput) {
  return {
    model: `models/${input.model}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voice } } },
    },
    systemInstruction: { parts: [{ text: input.instructions }] },
    tools: [{ functionDeclarations: geminiFunctionDeclarations(input.enabledFeatures) }],
    realtimeInputConfig: {
      automaticActivityDetection: {
        // A turn starts only on sustained speech: with high sensitivity, clicks, background noise and
        // the assistant's own echo started turns that cut replies off, which then started over.
        startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
        // Doesn't end the customer's turn on a short thinking pause in the middle of a sentence.
        endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
        prefixPaddingMs: 300,
        silenceDurationMs: 650,
      },
      activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
    },
    // Transcripts are what the chat, the inbox and the AI's memory show.
    inputAudioTranscription: { languageCodes: transcriptionLanguages(input.language) },
    outputAudioTranscription: {},
    // Every reply is billed on the whole call so far: past this size the oldest part is dropped in
    // one block (so the cached prefix keeps matching), keeping long calls cheap.
    contextWindowCompression: { triggerTokens: 24_000, slidingWindow: { targetTokens: 12_000 } },
    // Lets the browser reconnect to the same conversation when the server rotates the connection.
    sessionResumption: input.resumeHandle ? { handle: input.resumeHandle } : {},
  };
}

/** The same setup in the SDK's LiveConnectConstraints shape (the other request format the API documents). */
function liveConnectConstraints(setup: ReturnType<typeof geminiLiveSetup>) {
  const { model, generationConfig, ...rest } = setup;
  return { model, config: { ...generationConfig, ...rest } };
}

export type GeminiTokenResult = { token: string; status: number; error?: string };

/**
 * Mints a single-use ephemeral token with the setup locked in. The API reference documents the
 * setup as `bidiGenerateContentSetup` while the guide shows `liveConnectConstraints`; the second
 * form is tried when the first is rejected as a bad request.
 */
export async function mintGeminiLiveToken(apiKey: string, setup: ReturnType<typeof geminiLiveSetup> | null, timeoutMs = 15_000): Promise<GeminiTokenResult> {
  const now = Date.now();
  const base = {
    uses: 1,
    expireTime: new Date(now + (env.VOICE_MAX_SESSION_MINUTES + 15) * 60_000).toISOString(),
    newSessionExpireTime: new Date(now + NEW_SESSION_WINDOW_MS).toISOString(),
  };
  const attempt = async (body: Record<string, unknown>): Promise<GeminiTokenResult> => {
    const response = await fetch(`${GEMINI_BASE}/auth_tokens`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ ...base, ...body }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await response.json().catch(() => null)) as { name?: string; error?: { message?: string } } | null;
    if (response.ok && data?.name) return { token: data.name, status: response.status };
    return { token: "", status: response.status, error: data?.error?.message?.slice(0, 300) };
  };
  if (!setup) return attempt({});
  const first = await attempt({ bidiGenerateContentSetup: setup });
  if (first.token || first.status !== 400) return first;
  const second = await attempt({ liveConnectConstraints: liveConnectConstraints(setup) });
  return second.token ? second : first;
}

export type GeminiLiveGrant = {
  token: string;
  wsUrl: string;
  model: string;
  opener: string;
  expiresAt: number;
};

/** A short-lived token the browser uses to open the call, with our instructions and tools locked in. */
export async function createGeminiLiveSession(context: SessionContext, resumeHandle?: string): Promise<GeminiLiveGrant> {
  const apiKey = geminiLiveApiKey(context.store);
  if (!apiKey) throw new RealtimeError("Gemini live voice needs a Gemini API key in Admin → AI model.");
  const live = geminiLiveSettings(context.store);
  const [base, saved] = await Promise.all([
    realtimeInstructions(context),
    savedDetailsForVisitor(context.storeId, context.visitorId).catch(() => null),
  ]);
  const setup = geminiLiveSetup({
    instructions: `${base}\n\n${GEMINI_CALL_RULES}`,
    enabledFeatures: context.store.settings?.enabledFeatures,
    model: live.model,
    voice: live.voice,
    resumeHandle,
    language: storeLanguage(context.store),
  });
  const result = await mintGeminiLiveToken(apiKey, setup);
  if (!result.token) {
    logger.error("gemini_live.session_failed", { status: result.status, error: result.error });
    const reason =
      result.status === 400 && /api key/i.test(result.error ?? "")
        ? "Live voice couldn't start: the Gemini key in Admin → AI model was rejected."
        : result.status === 401 || result.status === 403
          ? "Live voice couldn't start: the Gemini key in Admin → AI model was rejected."
          : result.status === 429
            ? "Live voice is busy or the Gemini quota is used up. Please try again later."
            : "Live voice could not start. Please try again.";
    throw new RealtimeError(reason, result.status);
  }
  return {
    token: result.token,
    wsUrl: GEMINI_LIVE_WS_URL,
    model: live.model,
    opener: openerInstruction(saved, storeLanguage(context.store)),
    expiresAt: Date.now() + NEW_SESSION_WINDOW_MS,
  };
}

/** Live-capable models this key can use (for the dashboard's model picker). */
export async function listGeminiLiveModels(apiKey: string): Promise<string[]> {
  const response = await fetch(`${GEMINI_BASE}/models?pageSize=1000`, {
    headers: { "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new RealtimeError("Gemini rejected the request.", response.status);
  const body = (await response.json().catch(() => null)) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  } | null;
  return (body?.models ?? [])
    .filter((model) => model.supportedGenerationMethods?.includes("bidiGenerateContent"))
    .map((model) => String(model.name ?? "").replace(/^models\//, ""))
    .filter(Boolean);
}

function count(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function modalityCount(details: unknown, modality: string): number {
  if (!Array.isArray(details)) return 0;
  return details.reduce(
    (sum, entry) => sum + (entry && typeof entry === "object" && (entry as { modality?: string }).modality === modality ? count((entry as { tokenCount?: unknown }).tokenCount) : 0),
    0,
  );
}

/**
 * Gemini `usageMetadata`: `promptTokenCount` includes cached reads (`cachedContentTokenCount`), and
 * tool-use prompts and thoughts are billed on top of the prompt and response counts.
 */
export function normalizeGeminiUsage(raw: unknown): NormalizedUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const usage = raw as Record<string, unknown>;
  const prompt = count(usage.promptTokenCount) + count(usage.toolUsePromptTokenCount);
  const cached = Math.min(prompt, count(usage.cachedContentTokenCount));
  const thoughts = count(usage.thoughtsTokenCount);
  const output = count(usage.responseTokenCount ?? usage.candidatesTokenCount) + thoughts;
  if (prompt === 0 && output === 0) return null;
  const audioIn = modalityCount(usage.promptTokensDetails, "AUDIO");
  const cachedAudio = Math.min(audioIn, modalityCount(usage.cacheTokensDetails, "AUDIO"));
  return makeUsage({
    inputTokens: prompt - cached,
    outputTokens: output,
    cachedInputTokens: cached,
    reasoningTokens: thoughts,
    audioInputTokens: Math.max(0, audioIn - cachedAudio),
    cachedAudioInputTokens: cachedAudio,
    audioOutputTokens: modalityCount(usage.responseTokensDetails ?? usage.candidatesTokensDetails, "AUDIO"),
  });
}
