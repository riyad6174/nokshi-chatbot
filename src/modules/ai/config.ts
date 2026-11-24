import type { ChatbotSettings } from "@prisma/client";
import { env } from "@/lib/config/env";
import { decryptSecret } from "@/lib/crypto/secrets";
import { EFFORT_LEVELS, getPreset, type EffortLevel, type ProviderKind } from "@/modules/ai/presets";

export type AiConfig = {
  providerId: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  effort: EffortLevel;
  /** Tried once when the main model is out of quota or overloaded. */
  fallbackModel?: string;
};

export type AiConfigStatus = {
  config: AiConfig | null;
  providerId: string;
  model: string;
  keySource: "dashboard" | "environment" | "none";
  keyLast4: string;
  /** A key is stored but can't be decrypted (AUTH_SECRET changed). */
  keyUnreadable: boolean;
};

type SettingsLike = Pick<
  ChatbotSettings,
  "provider" | "model" | "aiBaseUrl" | "aiApiKeyEncrypted" | "aiApiKeyLast4" | "aiEffort"
> & Partial<Pick<ChatbotSettings, "aiFallbackModel">
> | null | undefined;

function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

/** Anything saved on Admin → AI model (the save always writes the provider, base URL and model). */
function savedInDashboard(settings: SettingsLike): boolean {
  if (!settings) return false;
  return Boolean(
    settings.model?.trim() ||
      settings.aiBaseUrl?.trim() ||
      settings.aiApiKeyEncrypted ||
      (settings.provider && settings.provider !== "openai-compatible"),
  );
}

/**
 * Admin → AI model is the source of truth: once a connection is saved there, its provider, base URL
 * and model are used as a whole, never mixed with the AI_PROVIDER / AI_BASE_URL / AI_MODEL
 * environment variables (those only apply while nothing is saved in the dashboard). The one
 * fallback is the key: without a saved key, AI_API_KEY is used, and the dashboard says so.
 * `config` is null when no usable connection exists, which keeps the widget in demo mode.
 */
export function resolveAiStatus(settings: SettingsLike): AiConfigStatus {
  const dashboard = savedInDashboard(settings);
  const providerId = dashboard ? settings?.provider || "openai-compatible" : env.AI_PROVIDER || "openai-compatible";
  const preset = getPreset(providerId);

  const storedKey = decryptSecret(settings?.aiApiKeyEncrypted);
  const keyUnreadable = Boolean(settings?.aiApiKeyEncrypted) && storedKey === null;
  // A saved key that can't be read must be re-entered; quietly using another key would hide that.
  const envKey = keyUnreadable ? "" : env.AI_API_KEY.trim();
  const apiKey = storedKey ?? envKey;
  const keySource = storedKey ? "dashboard" : envKey ? "environment" : "none";
  const keyLast4 = storedKey ? settings?.aiApiKeyLast4 ?? "" : envKey.slice(-4);

  const baseUrl = (
    dashboard
      ? settings?.aiBaseUrl || preset.baseUrl
      : preset.kind === "anthropic"
        ? ""
        : preset.baseUrl || env.AI_BASE_URL
  ).replace(/\/+$/, "");
  const model = dashboard ? settings?.model?.trim() || preset.suggestedModel : env.AI_MODEL || preset.suggestedModel;
  const effort = (EFFORT_LEVELS as readonly string[]).includes(settings?.aiEffort ?? "")
    ? (settings!.aiEffort as EffortLevel)
    : "medium";

  const keyOk = apiKey.length > 0 || (!preset.keyRequired && isLocalUrl(baseUrl));
  const baseOk = preset.kind === "anthropic" || baseUrl.length > 0;
  const savedFallback = settings?.aiFallbackModel?.trim();
  const fallbackModel = (dashboard && savedFallback) || preset.fallbackModel || "";
  const config = keyOk && baseOk && model
    ? { providerId: preset.id, kind: preset.kind, baseUrl, apiKey, model, effort, ...(fallbackModel && fallbackModel !== model ? { fallbackModel } : {}) }
    : null;

  return { config, providerId: preset.id, model, keySource, keyLast4, keyUnreadable };
}

export function resolveAiConfig(settings: SettingsLike): AiConfig | null {
  return resolveAiStatus(settings).config;
}
