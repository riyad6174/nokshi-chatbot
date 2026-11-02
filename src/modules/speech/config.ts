import { env } from "@/lib/config/env";
import { createAzureSpeechProvider } from "@/modules/speech/azure.provider";
import { createOpenAiSpeechProvider } from "@/modules/speech/openai.provider";
import type { SpeechProvider } from "@/modules/speech/speech-provider";

let cached: { key: string; provider: SpeechProvider | null } | null = null;

/** The server speech provider, or null when the browser does recognition and speaking itself. */
export function getSpeechProvider(): SpeechProvider | null {
  const key = [env.SPEECH_PROVIDER, env.SPEECH_API_KEY, env.SPEECH_REGION, env.SPEECH_BASE_URL].join("|");
  if (cached?.key === key) return cached.provider;

  const apiKey = env.SPEECH_API_KEY.trim();
  const voices = { en: env.SPEECH_VOICE_EN, bn: env.SPEECH_VOICE_BN };
  let provider: SpeechProvider | null = null;
  if (env.SPEECH_PROVIDER === "azure" && apiKey && env.SPEECH_REGION) {
    provider = createAzureSpeechProvider({ apiKey, region: env.SPEECH_REGION, voices, rate: env.SPEECH_RATE });
  } else if (env.SPEECH_PROVIDER === "openai" && apiKey) {
    provider = createOpenAiSpeechProvider({
      apiKey,
      baseUrl: env.SPEECH_BASE_URL.replace(/\/+$/, ""),
      sttModel: env.SPEECH_STT_MODEL,
      ttsModel: env.SPEECH_TTS_MODEL,
      voices,
    });
  }
  cached = { key, provider };
  return provider;
}

export function speechMode(): "server" | "browser" {
  return getSpeechProvider() ? "server" : "browser";
}
