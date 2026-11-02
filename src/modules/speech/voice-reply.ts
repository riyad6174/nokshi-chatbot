import { logger } from "@/lib/logging/logger";
import { createSentenceChunker } from "@/modules/speech/sentence-chunker";
import { detectLang, type SpeechLang, type SpeechProvider } from "@/modules/speech/speech-provider";

/**
 * Speaks a streamed reply sentence by sentence. Sentences are synthesized in parallel but sent in
 * order as `voice.sentence {seq, text, lang, audio}`; `audio` is base64 MP3, or null when the browser
 * should speak the text itself (no server provider, or synthesis failed).
 */
export function createVoiceReply(input: {
  provider: SpeechProvider | null;
  fallbackLang: SpeechLang;
  send: (event: string, data: unknown) => void;
  signal?: AbortSignal;
}) {
  const chunker = createSentenceChunker();
  let seq = 0;
  let chain = Promise.resolve();

  const speak = (text: string) => {
    const id = seq;
    seq += 1;
    const lang = detectLang(text, input.fallbackLang);
    const audio = input.provider
      ? input.provider
          .synthesize({ text, lang, signal: input.signal })
          .then((bytes) => bytes.toString("base64"))
          .catch((error) => {
            if (!input.signal?.aborted) {
              logger.warn("voice.tts_failed", { error: error instanceof Error ? error.message : String(error) });
            }
            return null;
          })
      : Promise.resolve(null);
    chain = chain.then(async () => {
      const encoded = await audio;
      input.send("voice.sentence", { seq: id, text, lang, audio: encoded, mime: encoded ? "audio/mpeg" : null });
    });
  };

  return {
    push(text: string) {
      for (const sentence of chunker.push(text)) speak(sentence);
    },
    async finish() {
      for (const sentence of chunker.flush()) speak(sentence);
      await chain;
      input.send("voice.done", { sentences: seq });
    },
  };
}
