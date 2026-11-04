"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import { encryptSecret, lastFour } from "@/lib/crypto/secrets";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import { aiConnectionFormSchema, voiceSettingsFormSchema } from "@/lib/validation/schemas";
import { resolveAiStatus, type AiConfig } from "@/modules/ai/config";
import { getPreset } from "@/modules/ai/presets";
import { realtimeApiKey } from "@/modules/realtime/realtime.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

const PATH = "/admin/ai";

async function adminStore() {
  await requireAdmin();
  const store = await getPrimaryStore();
  if (!store) redirect("/admin?error=store");
  return store;
}

function parseForm(formData: FormData) {
  return aiConnectionFormSchema.safeParse({
    provider: formData.get("provider") ?? "",
    baseUrl: formData.get("baseUrl") ?? "",
    apiKey: formData.get("apiKey") ?? "",
    clearKey: formData.get("clearKey") === "on",
    model: formData.get("model") ?? "",
    effort: formData.get("effort") ?? "medium",
  });
}

export async function saveAiConnectionAction(formData: FormData) {
  const store = await adminStore();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    redirect(`${PATH}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the fields.")}`);
  }
  const data = parsed.data;
  const preset = getPreset(data.provider);

  // A blank key field keeps the stored key; "remove" clears it (falling back to AI_API_KEY if set).
  const keyUpdate = data.apiKey
    ? { aiApiKeyEncrypted: encryptSecret(data.apiKey), aiApiKeyLast4: lastFour(data.apiKey) }
    : data.clearKey
      ? { aiApiKeyEncrypted: "", aiApiKeyLast4: "" }
      : {};

  const fields = {
    provider: preset.id,
    aiBaseUrl: preset.kind === "anthropic" ? data.baseUrl : data.baseUrl || preset.baseUrl,
    model: data.model,
    aiEffort: data.effort,
    ...keyUpdate,
  };

  await prisma.chatbotSettings.upsert({
    where: { storeId: store.id },
    update: fields,
    create: {
      storeId: store.id,
      welcomeMessage: "Hi! How can I help you shop today?",
      fallbackMessage: "I could not find that in the store information.",
      ...fields,
    },
  });

  // Never log the key itself; the logger also redacts key-like fields.
  logger.info("admin.ai_connection_saved", {
    storeId: store.id,
    provider: preset.id,
    model: data.model,
    keyChanged: Boolean(data.apiKey) || data.clearKey,
  });

  revalidatePath(PATH);
  revalidatePath("/admin");
  redirect(`${PATH}?saved=1`);
}

export type ConnectionTestResult = {
  ok: boolean;
  message: string;
  models: string[];
  latencyMs?: number;
};

function describeError(error: unknown): string {
  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403) return "The provider rejected the API key.";
  if (status === 404) return "The provider could not find that model or endpoint. Check the base URL and model name.";
  if (status === 429) return "The provider is rate-limiting this key. Try again shortly.";
  if (typeof status === "number" && status >= 500) return `The provider returned an error (${status}). Try again shortly.`;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "The provider did not respond within 10 seconds.";
  }
  return "Could not reach the provider. Check the base URL and your network.";
}

/** Tests the values currently in the form (not yet saved). A blank key field uses the saved key. */
export async function testAiConnectionAction(
  _previous: ConnectionTestResult | null,
  formData: FormData,
): Promise<ConnectionTestResult> {
  const store = await adminStore();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields.", models: [] };
  }
  const data = parsed.data;
  const preset = getPreset(data.provider);
  const saved = resolveAiStatus(store.settings);
  const apiKey = data.apiKey || (data.clearKey ? "" : saved.config?.apiKey ?? "");

  if (preset.keyRequired && !apiKey) {
    return { ok: false, message: "Enter an API key to test this provider.", models: [] };
  }

  const config: AiConfig = {
    providerId: preset.id,
    kind: preset.kind,
    baseUrl: (preset.kind === "anthropic" ? data.baseUrl : data.baseUrl || preset.baseUrl).replace(/\/+$/, ""),
    apiKey,
    model: data.model,
    effort: data.effort,
  };
  if (config.kind !== "anthropic" && !config.baseUrl) {
    return { ok: false, message: "Enter the provider's base URL.", models: [] };
  }

  const started = Date.now();
  try {
    if (config.kind === "anthropic") {
      const { checkAnthropicConnection, listAnthropicModels } = await import("@/modules/ai/anthropic.provider");
      const models = await listAnthropicModels(config).catch(() => [] as string[]);
      const found = await checkAnthropicConnection(config);
      return {
        ok: true,
        message: `Connected. ${found.displayName} (${found.model}) is available to this key.`,
        models,
        latencyMs: Date.now() - started,
      };
    }

    const { listOpenAiCompatibleModels } = await import("@/modules/ai/provider");
    const models = await listOpenAiCompatibleModels(config);
    const latencyMs = Date.now() - started;
    if (models.length > 0 && !models.includes(config.model)) {
      return {
        ok: false,
        message: `The key works, but "${config.model}" isn't in this provider's model list. Pick one below.`,
        models,
        latencyMs,
      };
    }
    return {
      ok: true,
      message: models.length > 0 ? `Connected. "${config.model}" is available.` : "Connected. The provider didn't list its models.",
      models,
      latencyMs,
    };
  } catch (error) {
    logger.warn("admin.ai_connection_test_failed", {
      provider: preset.id,
      status: (error as { status?: number })?.status ?? null,
    });
    return { ok: false, message: describeError(error), models: [], latencyMs: Date.now() - started };
  }
}

// --- Live voice (OpenAI Realtime) ---------------------------------------------------------------

function parseVoiceForm(formData: FormData) {
  return voiceSettingsFormSchema.safeParse({
    engine: formData.get("engine") ?? "realtime",
    model: formData.get("model") ?? "",
    voice: formData.get("voice") ?? "",
    speed: formData.get("speed") ?? "1",
    style: formData.get("style") ?? "",
    apiKey: formData.get("apiKey") ?? "",
    clearKey: formData.get("clearKey") === "on",
  });
}

export async function saveVoiceSettingsAction(formData: FormData) {
  const store = await adminStore();
  const parsed = parseVoiceForm(formData);
  if (!parsed.success) {
    redirect(`${PATH}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the voice fields.")}`);
  }
  const data = parsed.data;
  // A blank key field keeps the stored voice key; "remove" goes back to the AI model key above.
  const keyUpdate = data.apiKey
    ? { realtimeApiKeyEncrypted: encryptSecret(data.apiKey), realtimeApiKeyLast4: lastFour(data.apiKey) }
    : data.clearKey
      ? { realtimeApiKeyEncrypted: "", realtimeApiKeyLast4: "" }
      : {};
  const fields = {
    voiceEngine: data.engine,
    realtimeModel: data.model,
    realtimeVoice: data.voice,
    realtimeVoiceSpeed: data.speed,
    realtimeVoiceStyle: data.style,
    ...keyUpdate,
  };

  await prisma.chatbotSettings.upsert({
    where: { storeId: store.id },
    update: fields,
    create: {
      storeId: store.id,
      welcomeMessage: "Hi! How can I help you shop today?",
      fallbackMessage: "I could not find that in the store information.",
      ...fields,
    },
  });
  logger.info("admin.voice_settings_saved", {
    storeId: store.id,
    engine: data.engine,
    model: data.model,
    keyChanged: Boolean(data.apiKey) || data.clearKey,
  });

  revalidatePath(PATH);
  redirect(`${PATH}?saved=voice`);
}

/** Checks the voice key and model by minting a call token (free; no call is made with it). */
export async function testVoiceConnectionAction(
  _previous: ConnectionTestResult | null,
  formData: FormData,
): Promise<ConnectionTestResult> {
  const store = await adminStore();
  const parsed = parseVoiceForm(formData);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the voice fields.", models: [] };
  const data = parsed.data;
  const withoutSavedVoiceKey = { settings: store.settings ? { ...store.settings, realtimeApiKeyEncrypted: "" } : null };
  const apiKey = data.apiKey || realtimeApiKey(data.clearKey ? withoutSavedVoiceKey : store);
  if (!apiKey) {
    return { ok: false, message: "No OpenAI key: enter one here, or use OpenAI as the AI model provider above.", models: [] };
  }

  const started = Date.now();
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 10 },
        session: { type: "realtime", model: data.model, audio: { output: { voice: data.voice, speed: data.speed } } },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Date.now() - started;
    if (response.ok) return { ok: true, message: `Connected. "${data.model}" with the "${data.voice}" voice is ready.`, models: [], latencyMs };
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    const detail = body?.error?.message?.slice(0, 200);
    if (response.status === 401) return { ok: false, message: "OpenAI rejected the API key.", models: [], latencyMs };
    if (response.status === 429) return { ok: false, message: "OpenAI is rate-limiting this key, or the account is out of credit.", models: [], latencyMs };
    return { ok: false, message: detail ? `OpenAI said: ${detail}` : `OpenAI returned an error (${response.status}).`, models: [], latencyMs };
  } catch (error) {
    return { ok: false, message: describeError(error), models: [], latencyMs: Date.now() - started };
  }
}
