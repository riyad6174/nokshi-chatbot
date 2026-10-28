"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Records a voice note (MediaRecorder) and, where the browser supports it, transcribes it at the
// same time with the Web Speech API. The transcript is what the assistant reads; the audio is kept
// so a human agent can listen to it.

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export type VoiceNote = { blob: Blob; mime: string; durationMs: number; transcript: string };

const MAX_MS = 2 * 60_000;

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function pickMime(): string {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return options.find((mime) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) ?? "";
}

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState({ record: false, transcribe: false });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const finalTextRef = useRef("");
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const resolveRef = useRef<((note: VoiceNote | null) => void) | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    setSupported({
      record: typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia),
      transcribe: recognitionCtor() !== null,
    });
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    try {
      recognitionRef.current?.abort();
    } catch {
      // Already stopped.
    }
    recognitionRef.current = null;
    setRecording(false);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback((): Promise<VoiceNote | null> => {
    const recorder = recorderRef.current;
    if (!recorder) return Promise.resolve(null);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      try {
        recognitionRef.current?.stop();
      } catch {
        // Ignore.
      }
      // Give the recognizer a moment to deliver its final result.
      window.setTimeout(() => recorder.state !== "inactive" && recorder.stop(), 350);
    });
  }, []);

  const start = useCallback(
    async (lang: string) => {
      setError(null);
      setTranscript("");
      finalTextRef.current = "";
      chunksRef.current = [];
      cancelledRef.current = false;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setError("Microphone access was blocked. Allow it in your browser to send voice messages.");
        return false;
      }

      const mime = pickMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const durationMs = Date.now() - startedAtRef.current;
        const type = recorder.mimeType || mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const note = cancelledRef.current || blob.size === 0
          ? null
          : { blob, mime: type, durationMs, transcript: finalTextRef.current.trim() };
        cleanup();
        resolveRef.current?.(note);
        resolveRef.current = null;
      };
      recorderRef.current = recorder;

      const Recognition = recognitionCtor();
      if (Recognition) {
        const recognition = new Recognition();
        recognition.lang = lang;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event) => {
          let interim = "";
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index]!;
            if (result.isFinal) finalTextRef.current += `${result[0].transcript} `;
            else interim += result[0].transcript;
          }
          setTranscript(`${finalTextRef.current}${interim}`.trim());
        };
        recognition.onerror = () => {
          // Transcription is best-effort; the audio is still recorded.
        };
        try {
          recognition.start();
          recognitionRef.current = recognition;
        } catch {
          recognitionRef.current = null;
        }
      }

      startedAtRef.current = Date.now();
      setElapsedMs(0);
      recorder.start(250);
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(elapsed);
        if (elapsed >= MAX_MS) void stop();
      }, 200);
      return true;
    },
    [cleanup, stop],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else cleanup();
    setTranscript("");
  }, [cleanup]);

  return { recording, elapsedMs, transcript, error, supported, start, stop, cancel, clearError: () => setError(null) };
}
