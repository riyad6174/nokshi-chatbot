// Speech-to-text and text-to-speech behind one interface, so the voice assistant can run on
// Azure, OpenAI, or (with no server provider) the visitor's own browser.

export type SpeechLang = "en" | "bn";

export type TranscribeInput = {
  audio: Buffer;
  /** e.g. "audio/wav", "audio/webm" */
  mime: string;
  lang: SpeechLang;
  signal?: AbortSignal;
};

/** confidence: 0..1 when the provider reports it (Azure); undefined otherwise. */
export type TranscribeResult = { text: string; lang: SpeechLang; confidence?: number };

export type SynthesizeInput = { text: string; lang: SpeechLang; signal?: AbortSignal };

export type SpeechProvider = {
  id: "azure" | "openai";
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
  /** Returns MP3 bytes. */
  synthesize(input: SynthesizeInput): Promise<Buffer>;
};

export class SpeechError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "SpeechError";
    this.status = status;
  }
}

const BENGALI = /[ঀ-৿]/;

/** Language of a piece of text, by script. Lets one reply mix English and Bangla sentences. */
export function detectLang(text: string, fallback: SpeechLang = "en"): SpeechLang {
  if (BENGALI.test(text)) return "bn";
  return /[A-Za-z]/.test(text) ? "en" : fallback;
}

export function toSpeechLang(locale: string | null | undefined): SpeechLang {
  return locale?.toLowerCase().startsWith("bn") ? "bn" : "en";
}
