import { SpeechError, type SpeechLang, type SpeechProvider } from "@/modules/speech/speech-provider";

// Azure AI Speech REST APIs: short-audio recognition (WAV/OGG, up to 60 s) and neural TTS.

const RECOGNITION_LOCALES: Record<SpeechLang, string> = { en: "en-US", bn: "bn-IN" };
const SYNTHESIS_LOCALES: Record<SpeechLang, string> = { en: "en-US", bn: "bn-BD" };
// The locale multilingual voices use for each language (their Bangla is listed as bn-IN).
const MULTILINGUAL_LOCALES: Record<SpeechLang, string> = { en: "en-US", bn: "bn-IN" };
const DEFAULT_VOICES: Record<SpeechLang, string> = {
  en: "en-US-AvaMultilingualNeural",
  bn: "bn-BD-NabanitaNeural",
};

const XML_ESCAPES: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" };

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (char) => XML_ESCAPES[char] ?? char);
}

export function createAzureSpeechProvider(config: {
  apiKey: string;
  region: string;
  voices: Partial<Record<SpeechLang, string>>;
  /** Prosody rate, e.g. "+10%". */
  rate?: string;
}): SpeechProvider {
  const headers = { "Ocp-Apim-Subscription-Key": config.apiKey };

  return {
    id: "azure",
    async transcribe({ audio, mime, lang, signal }) {
      const contentType = mime.includes("ogg")
        ? "audio/ogg; codecs=opus"
        : "audio/wav; codecs=audio/pcm; samplerate=16000";
      const url =
        `https://${config.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
        `?language=${RECOGNITION_LOCALES[lang]}&format=detailed&profanity=raw`;
      const response = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": contentType, Accept: "application/json" },
        body: new Uint8Array(audio),
        signal,
      });
      if (!response.ok) throw new SpeechError("Speech recognition failed.", response.status);
      const body = (await response.json().catch(() => null)) as {
        RecognitionStatus?: string;
        DisplayText?: string;
        NBest?: Array<{ Confidence?: number; Display?: string }>;
      } | null;
      // NoMatch / InitialSilenceTimeout: nothing intelligible was said.
      if (body?.RecognitionStatus !== "Success") return { text: "", lang };
      const best = body.NBest?.[0];
      return { text: (best?.Display ?? body.DisplayText ?? "").trim(), lang, confidence: best?.Confidence };
    },
    async synthesize({ text, lang, signal }) {
      const voice = config.voices[lang] || DEFAULT_VOICES[lang];
      const spoken = `<prosody rate="${escapeXml(config.rate || "0%")}">${escapeXml(text)}</prosody>`;
      // Multilingual voices (e.g. the HD "Dragon" voices) need to be told which language to speak.
      const native = voice.toLowerCase().startsWith(lang === "bn" ? "bn-" : "en-");
      const ssml =
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${SYNTHESIS_LOCALES[lang]}">` +
        `<voice name="${escapeXml(voice)}">${native ? spoken : `<lang xml:lang="${MULTILINGUAL_LOCALES[lang]}">${spoken}</lang>`}</voice></speak>`;
      const response = await fetch(`https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          "User-Agent": "nokshi-shopping-assistant",
        },
        body: ssml,
        signal,
      });
      if (!response.ok) throw new SpeechError("Speech synthesis failed.", response.status);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
