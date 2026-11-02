import { detectLang, SpeechError, type SpeechLang, type SpeechProvider } from "@/modules/speech/speech-provider";

// OpenAI (or compatible) /audio/transcriptions and /audio/speech.

// Context for the recognizer: who is speaking and the words to expect.
const TRANSCRIPTION_HINTS: Record<SpeechLang, string> = {
  bn: "বাংলাদেশি ক্রেতা অনলাইন দোকানের সাথে বাংলায় কথা বলছেন: প্রোডাক্ট, দাম, অর্ডার, কার্ট, ঘড়ি, ব্যাগ, জামা, নাম, ফোন নম্বর জিরো ওয়ান..., ঠিকানা, জেলা।",
  en: "A customer in Bangladesh talking to an online shop: products, price, order, cart, name, phone number, delivery address, district.",
};

/** Bangla transcripts sometimes come back with Assamese letters (ৰ, ৱ); map them to Bangla. */
function cleanTranscript(text: string, lang: SpeechLang): string {
  return lang === "bn" ? text.replace(/\u09F0/g, "র").replace(/\u09F1/g, "ব") : text;
}

export function createOpenAiSpeechProvider(config: {
  apiKey: string;
  baseUrl: string;
  sttModel: string;
  ttsModel: string;
  voices: Partial<Record<SpeechLang, string>>;
}): SpeechProvider {
  const auth = { Authorization: `Bearer ${config.apiKey}` };

  return {
    id: "openai",
    async transcribe({ audio, mime, lang, signal }) {
      const extension = mime.includes("webm") ? "webm" : mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "wav";
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `utterance.${extension}`);
      form.append("model", config.sttModel);
      // Always give the language: auto-detection hears Bangladeshi Bangla as Urdu or Assamese.
      // English in Bangla mode comes back in Bangla letters, which the assistant handles.
      form.append("language", lang);
      form.append("prompt", TRANSCRIPTION_HINTS[lang]);
      form.append("response_format", "json");
      const response = await fetch(`${config.baseUrl}/audio/transcriptions`, { method: "POST", headers: auth, body: form, signal });
      if (!response.ok) throw new SpeechError("Speech recognition failed.", response.status);
      const body = (await response.json().catch(() => null)) as { text?: string } | null;
      const text = cleanTranscript(body?.text?.trim() ?? "", lang);
      return { text, lang: detectLang(text, lang) };
    },
    async synthesize({ text, lang, signal }) {
      const response = await fetch(`${config.baseUrl}/audio/speech`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.ttsModel,
          voice: config.voices[lang] || "alloy",
          input: text,
          response_format: "mp3",
          instructions:
            lang === "bn"
              ? "Speak natural Bangladeshi Bangla, warm and friendly, at a relaxed pace."
              : "Speak like a warm, upbeat shop assistant at a relaxed pace.",
        }),
        signal,
      });
      if (!response.ok) throw new SpeechError("Speech synthesis failed.", response.status);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
