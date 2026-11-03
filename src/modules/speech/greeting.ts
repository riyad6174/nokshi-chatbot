import { createHash } from "node:crypto";
import { logger } from "@/lib/logging/logger";
import { getSpeechProvider } from "@/modules/speech/config";
import type { SpeechLang } from "@/modules/speech/speech-provider";
import { parseJsonObject, type StoreWithSettings } from "@/modules/stores/store.service";

export type GreetingKind = "welcome" | "start";

const DEFAULTS: Record<GreetingKind, Record<SpeechLang, string>> = {
  welcome: {
    en: "Hello, I'm your voice assistant. Let me know how I can help you.",
    bn: "হ্যালো, আমি আপনার voice assistant। আপনাকে কিভাবে সাহায্য করতে পারি আমাকে জানান।",
  },
  start: {
    en: "Hello, I'm listening.",
    bn: "হ্যালো, আমি শুনছি।",
  },
};

/** Voice opener for a customer whose name is already known. */
export function knownCustomerOpener(name: string, lang: SpeechLang): string {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return lang === "bn" ? `হ্যালো ${first}, আমি শুনছি।` : `Hello ${first}, I'm listening.`;
}

export function voiceAssistantEnabled(store: StoreWithSettings): boolean {
  const settings = store.settings;
  return (settings?.voiceEnabled ?? true) && (settings?.voiceAssistantEnabled ?? true);
}

export function greetingText(store: StoreWithSettings, kind: GreetingKind, lang: SpeechLang): string {
  const settings = store.settings;
  const configured = kind === "welcome" ? parseJsonObject(settings?.welcomeVoiceText)[lang] : undefined;
  const template = typeof configured === "string" && configured.trim() ? configured.trim() : DEFAULTS[kind][lang];
  return template
    .replaceAll("{store}", store.name)
    .replaceAll("{assistant}", settings?.assistantName || "your shopping assistant");
}

// Greetings are the same for every visitor: synthesize once per text and voice.
const cache = new Map<string, string>();
const MAX_CACHED = 64;

/** Base64 MP3 of a fixed store line, or null when the browser speaks it (no provider / failure). */
export async function synthesizeCached(text: string, lang: SpeechLang): Promise<string | null> {
  const provider = getSpeechProvider();
  if (!provider) return null;
  const key = createHash("sha256").update(`${provider.id}|${lang}|${text}`).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const audio = (await provider.synthesize({ text, lang, signal: AbortSignal.timeout(15_000) })).toString("base64");
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
    cache.set(key, audio);
    return audio;
  } catch (error) {
    logger.warn("voice.greeting_tts_failed", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
