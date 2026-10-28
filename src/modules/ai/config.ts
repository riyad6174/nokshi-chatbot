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
> | null | undefined;

function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

/**
 * Dashboard settings win; empty fields fall back to the AI_* environment variables.
 * `config` is null when no usable connection exists, which keeps the widget in demo mode.
 */
export function resolveAiStatus(settings: SettingsLike): AiConfigStatus {
  const providerId = settings?.provider && settings.provider !== "openai-compatible"
    ? settings.provider
    : env.AI_PROVIDER || "openai-compatible";
  const preset = getPreset(providerId);

  const storedKey = decryptSecret(settings?.aiApiKeyEncrypted);
  const keyUnreadable = Boolean(settings?.aiApiKeyEncrypted) && storedKey === null;
  const envKey = env.AI_API_KEY.trim();
  const apiKey = storedKey ?? envKey;
  const keySource = storedKey ? "dashboard" : envKey ? "environment" : "none";
  const keyLast4 = storedKey ? settings?.aiApiKeyLast4 ?? "" : envKey.slice(-4);

  const baseUrl = (settings?.aiBaseUrl || (preset.kind === "anthropic" ? "" : preset.baseUrl || env.AI_BASE_URL))
    .replace(/\/+$/, "");
  const model = settings?.model || preset.suggestedModel || env.AI_MODEL;
  const effort = (EFFORT_LEVELS as readonly string[]).includes(settings?.aiEffort ?? "")
    ? (settings!.aiEffort as EffortLevel)
    : "medium";

  const keyOk = apiKey.length > 0 || (!preset.keyRequired && isLocalUrl(baseUrl));
  const baseOk = preset.kind === "anthropic" || baseUrl.length > 0;
  const config = keyOk && baseOk && model
    ? { providerId: preset.id, kind: preset.kind, baseUrl, apiKey, model, effort }
    : null;

  return { config, providerId: preset.id, model, keySource, keyLast4, keyUnreadable };
}

export function resolveAiConfig(settings: SettingsLike): AiConfig | null {
  return resolveAiStatus(settings).config;
}
