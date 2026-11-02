"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav } from "@/lib/client/wav";

// Hands-free voice conversation: listens continuously, detects when the customer stops talking,
// hands each utterance to `onUtterance`, and plays the spoken reply sentence by sentence.
//
// speech "server": the mic is captured with an AudioWorklet and a simple energy-based voice
//   activity detector; utterances go to the server as 16 kHz WAV. Talking over the assistant
//   interrupts it (barge-in).
// speech "browser": the browser's SpeechRecognition transcribes and speechSynthesis speaks. The
//   browser recognizer has no echo cancellation, so it would hear (and answer) the assistant's own
//   voice: it pauses while the assistant speaks and for a moment after. Interrupt with stop().
//
// Interrupting never loses context: the server keeps the part of the reply that was produced.

export type VoicePhase = "off" | "starting" | "listening" | "hearing" | "thinking" | "speaking" | "paused";
export type VoiceLang = "en" | "bn";
/** assistantSaid: set when the customer spoke while (or right after) the assistant talked, so the server can drop echo. */
export type Utterance = { audio?: Blob; transcript?: string; durationMs: number; assistantSaid?: string };
export type SpokenSentence = { text: string; lang: VoiceLang; audio: string | null; mime: string | null };
export type VoiceTurn = { signal: AbortSignal; speak: (sentence: SpokenSentence) => void };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};

type StartOptions = { speech: "server" | "browser"; lang: VoiceLang; maxSessionMinutes: number };

/** Pause after this long with nobody talking, so the mic isn't left open. */
const IDLE_PAUSE_MS = 20_000;
const MAX_UTTERANCE_MS = 30_000;
const END_SILENCE_MS = 900;
const PREROLL_MS = 400;
/** The recognizer often reports the assistant's echo a moment after it stopped talking. */
const ECHO_WINDOW_MS = 1500;
/** Browser mode: how long after the assistant stops before listening again (room echo, late results). */
const BROWSER_RESUME_MS = 700;

// Batches 128-sample render quanta into ~1024-sample frames for the main thread.
const WORKLET_SOURCE = `
class VadCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(1024); this.length = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.length++] = channel[i];
        if (this.length === this.buffer.length) { this.port.postMessage(this.buffer.slice(0)); this.length = 0; }
      }
    }
    return true;
  }
}
registerProcessor("vad-capture", VadCapture);
`;

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether `heard` contains enough words the assistant didn't just say to be the customer talking. */
function soundsLikeCustomer(heard: string, spoken: string): boolean {
  const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((word) => word.length > 1);
  const said = new Set(words(spoken));
  const heardWords = words(heard);
  const fresh = heardWords.filter((word) => !said.has(word)).length;
  return fresh >= 3 && fresh / Math.max(heardWords.length, 1) >= 0.5;
}

function bcp47(lang: VoiceLang): string {
  return lang === "bn" ? "bn-BD" : "en-US";
}

export function voiceSupport() {
  if (typeof window === "undefined") return { server: false, browser: false };
  const mic = Boolean(navigator.mediaDevices?.getUserMedia) && typeof AudioWorkletNode !== "undefined";
  return { server: mic, browser: recognitionCtor() !== null && "speechSynthesis" in window };
}

export function useVoiceSession(options: { onUtterance: (utterance: Utterance, turn: VoiceTurn) => Promise<void> }) {
  const [phase, setPhaseState] = useState<VoicePhase>("off");
  const [level, setLevel] = useState(0);
  const [liveText, setLiveText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lang, setLangState] = useState<VoiceLang>("en");

  const onUtteranceRef = useRef(options.onUtterance);
  onUtteranceRef.current = options.onUtterance;

  const configRef = useRef<StartOptions>({ speech: "browser", lang: "en", maxSessionMinutes: 15 });
  const phaseRef = useRef<VoicePhase>("off");
  const hearingRef = useRef(false);
  const turnRef = useRef<{ controller: AbortController } | null>(null);
  const queueRef = useRef<SpokenSentence[]>([]);
  /** What the assistant said most recently, to tell its own echo apart from the customer. */
  const recentSpeechRef = useRef("");
  const lastPlaybackEndRef = useRef(0);
  /** Browser mode: don't listen before this time (performance.now()). */
  const listenAfterRef = useRef(0);
  const resumeTimerRef = useRef<number | null>(null);
  const resetHeardRef = useRef<() => void>(() => undefined);
  /** End the session once the assistant has finished what it's saying (e.g. after an order). */
  const endAfterSpeechRef = useRef(false);
  const stopAfterSpeechRef = useRef<() => void>(() => undefined);
  const playingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recognitionRunningRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);
  const sessionTimerRef = useRef<number | null>(null);
  const lastLevelAtRef = useRef(0);
  const vadRef = useRef({
    floor: 0.008,
    inSpeech: false,
    onsetMs: 0,
    voicedMs: 0,
    silenceMs: 0,
    totalMs: 0,
    preroll: [] as Float32Array[],
    prerollMs: 0,
    chunks: [] as Float32Array[],
    duringEcho: false,
  });

  const setPhase = useCallback((next: VoicePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const active = () => !["off", "paused", "starting"].includes(phaseRef.current);

  // --- browser speech recognition ------------------------------------------------------------

  const syncRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    const waitMs = listenAfterRef.current - performance.now();
    if (active() && !playingRef.current && waitMs > 0) {
      if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = window.setTimeout(() => syncRecognitionRef.current(), waitMs + 20);
    }
    const wanted = active() && !playingRef.current && waitMs <= 0;
    if (wanted && !recognitionRunningRef.current) {
      try {
        recognition.lang = bcp47(configRef.current.lang);
        recognition.start();
        recognitionRunningRef.current = true;
      } catch {
        // Already starting; onend restarts it.
      }
    } else if (!wanted && recognitionRunningRef.current) {
      recognitionRunningRef.current = false;
      // Whatever was half-heard is dropped: it would be mixed with the assistant's voice.
      resetHeardRef.current();
      try {
        recognition.abort();
      } catch {
        // Already stopped.
      }
    }
  }, []);
  const syncRecognitionRef = useRef(syncRecognition);
  syncRecognitionRef.current = syncRecognition;

  // --- phase bookkeeping ---------------------------------------------------------------------

  const pauseRef = useRef<() => void>(() => undefined);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      if (phaseRef.current === "listening") pauseRef.current();
    }, IDLE_PAUSE_MS);
  }, []);

  const refreshPhase = useCallback(() => {
    if (!active()) return;
    const next: VoicePhase = playingRef.current
      ? "speaking"
      : hearingRef.current
        ? "hearing"
        : turnRef.current
          ? "thinking"
          : "listening";
    if (next === "listening" && endAfterSpeechRef.current) {
      stopAfterSpeechRef.current();
      return;
    }
    if (next !== phaseRef.current) {
      setPhase(next);
      if (next === "listening") resetIdleTimer();
    }
    if (configRef.current.speech === "browser") syncRecognition();
  }, [resetIdleTimer, setPhase, syncRecognition]);

  // --- playback ------------------------------------------------------------------------------

  const playNext = useCallback(() => {
    if (playingRef.current) return;
    const sentence = queueRef.current.shift();
    if (sentence) recentSpeechRef.current = `${recentSpeechRef.current} ${sentence.text}`.slice(-600);
    if (!sentence) {
      refreshPhase();
      return;
    }
    playingRef.current = true;
    refreshPhase();

    const done = () => {
      if (!playingRef.current) return;
      playingRef.current = false;
      lastPlaybackEndRef.current = performance.now();
      listenAfterRef.current = performance.now() + BROWSER_RESUME_MS;
      playNext();
    };
    const speakWithBrowser = () => {
      if (!("speechSynthesis" in window)) return done();
      const utterance = new SpeechSynthesisUtterance(sentence.text);
      utterance.lang = bcp47(sentence.lang);
      const voice = window.speechSynthesis.getVoices().find((entry) => entry.lang.replace("_", "-").startsWith(sentence.lang));
      if (voice) utterance.voice = voice;
      utterance.onend = done;
      utterance.onerror = done;
      window.speechSynthesis.speak(utterance);
    };

    const audio = audioRef.current;
    if (sentence.audio && audio) {
      audio.volume = 1;
      audio.onended = done;
      audio.onerror = () => speakWithBrowser();
      audio.src = `data:${sentence.mime || "audio/mpeg"};base64,${sentence.audio}`;
      audio.play().catch(() => speakWithBrowser());
    } else {
      speakWithBrowser();
    }
  }, [refreshPhase]);

  const stopPlayback = useCallback(() => {
    queueRef.current = [];
    if (playingRef.current) {
      lastPlaybackEndRef.current = performance.now();
      // Stopped on purpose: the customer wants to talk, so listen again almost at once.
      listenAfterRef.current = performance.now() + 250;
    }
    playingRef.current = false;
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  /** Stops the assistant mid-reply and abandons the turn in flight. */
  const interrupt = useCallback(() => {
    turnRef.current?.controller.abort();
    turnRef.current = null;
    stopPlayback();
    refreshPhase();
  }, [refreshPhase, stopPlayback]);

  /** A typed message (e.g. a details form) sent as a voice turn, so the answer is spoken. */
  const submitText = useCallback((text: string) => handleUtteranceRef.current({ transcript: text, durationMs: 0 }), []);

  /** Speaks a line outside a customer turn (e.g. the opening greeting). */
  const say = useCallback(
    (sentence: SpokenSentence) => {
      queueRef.current.push(sentence);
      playNext();
    },
    [playNext],
  );

  // --- turns ---------------------------------------------------------------------------------

  const handleUtterance = useCallback(
    async (utterance: Utterance) => {
      interrupt();
      const turn = { controller: new AbortController() };
      turnRef.current = turn;
      refreshPhase();
      const speak = (sentence: SpokenSentence) => {
        if (turn.controller.signal.aborted) return;
        queueRef.current.push(sentence);
        playNext();
      };
      try {
        await onUtteranceRef.current(utterance, { signal: turn.controller.signal, speak });
      } catch {
        // The caller shows its own error; keep listening.
      } finally {
        if (turnRef.current === turn) turnRef.current = null;
        setLiveText("");
        refreshPhase();
      }
    },
    [interrupt, playNext, refreshPhase],
  );
  const handleUtteranceRef = useRef(handleUtterance);
  handleUtteranceRef.current = handleUtterance;

  /** The assistant is talking, or just stopped: what the mic hears may be its own voice. */
  const echoRisk = () => playingRef.current || performance.now() - lastPlaybackEndRef.current < ECHO_WINDOW_MS;

  // --- server mode: microphone + voice activity detection --------------------------------------

  const onFrame = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      const frameMs = (samples.length / sampleRate) * 1000;
      let sum = 0;
      for (let index = 0; index < samples.length; index += 1) sum += samples[index]! * samples[index]!;
      const rms = Math.sqrt(sum / samples.length);

      const now = performance.now();
      if (now - lastLevelAtRef.current > 80) {
        lastLevelAtRef.current = now;
        setLevel(Math.min(1, rms * 10));
      }
      if (!active()) return;

      const vad = vadRef.current;
      // While the assistant talks, demand a louder, longer onset so its own voice leaking through
      // the speakers doesn't count as the customer interrupting.
      const busy = playingRef.current;
      const threshold = busy ? Math.max(0.03, vad.floor * 4) : Math.max(0.012, vad.floor * 2.8);
      const loud = rms > threshold;

      vad.preroll.push(samples);
      vad.prerollMs += frameMs;
      while (vad.prerollMs > PREROLL_MS && vad.preroll.length > 1) {
        const dropped = vad.preroll.shift()!;
        vad.prerollMs -= (dropped.length / sampleRate) * 1000;
      }

      if (!vad.inSpeech) {
        if (loud) {
          vad.onsetMs += frameMs;
        } else {
          vad.onsetMs = Math.max(0, vad.onsetMs - frameMs);
          vad.floor = Math.min(0.05, vad.floor * 0.95 + rms * 0.05);
        }
        if (vad.onsetMs >= (busy ? 180 : 120)) {
          vad.inSpeech = true;
          vad.chunks = [...vad.preroll];
          vad.voicedMs = vad.onsetMs;
          vad.silenceMs = 0;
          vad.totalMs = vad.prerollMs;
          vad.duringEcho = echoRisk();
          if (busy) {
            if (audioRef.current) audioRef.current.volume = 0.25;
          } else if (turnRef.current) {
            interrupt();
          }
          hearingRef.current = true;
          refreshPhase();
        }
        return;
      }

      vad.chunks.push(samples);
      vad.totalMs += frameMs;
      if (loud) {
        vad.voicedMs += frameMs;
        vad.silenceMs = 0;
      } else {
        vad.silenceMs += frameMs;
      }
      if (vad.silenceMs >= END_SILENCE_MS || vad.totalMs >= MAX_UTTERANCE_MS) {
        const chunks = vad.chunks;
        // Over the assistant's voice, a short blip is far more likely echo or noise than a customer.
        const enough = vad.voicedMs >= (vad.duringEcho ? 650 : 300);
        const durationMs = Math.round(vad.totalMs);
        vad.inSpeech = false;
        vad.onsetMs = 0;
        vad.chunks = [];
        hearingRef.current = false;
        if (enough) {
          void handleUtterance({
            audio: encodeWav(chunks, sampleRate),
            durationMs,
            assistantSaid: vad.duringEcho ? recentSpeechRef.current : undefined,
          });
        } else {
          if (audioRef.current) audioRef.current.volume = 1;
          refreshPhase();
        }
      }
    },
    [handleUtterance, interrupt, refreshPhase],
  );

  const startServerCapture = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    streamRef.current = stream;
    const context = new AudioContext();
    contextRef.current = context;
    const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
    try {
      await context.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "vad-capture");
    node.port.onmessage = (event: MessageEvent<Float32Array>) => onFrame(event.data, context.sampleRate);
    // Some browsers only run nodes that reach the destination: route through a muted gain.
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(context.destination);
    if (context.state === "suspended") await context.resume();
  }, [onFrame]);

  // --- browser mode: SpeechRecognition ---------------------------------------------------------

  const startBrowserRecognition = useCallback(() => {
    const Recognition = recognitionCtor();
    if (!Recognition) throw new Error("unsupported");
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    let finalText = "";
    let endTimer: number | null = null;
    let heardOverEcho = false;
    resetHeardRef.current = () => {
      finalText = "";
      heardOverEcho = false;
      if (endTimer) window.clearTimeout(endTimer);
      endTimer = null;
      hearingRef.current = false;
      setLiveText("");
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]!;
        if (result.isFinal) finalText += `${result[0].transcript} `;
        else interim += result[0].transcript;
      }
      const heard = `${finalText}${interim}`.trim();
      if (!heard) return;
      // While the assistant talks, the mic may pick up its voice: only words it isn't saying count.
      if (echoRisk() && !hearingRef.current) {
        if (!soundsLikeCustomer(heard, recentSpeechRef.current)) {
          if (!interim) finalText = "";
          return;
        }
        heardOverEcho = true;
      }
      setLiveText(heard);
      if (turnRef.current || playingRef.current) interrupt();
      hearingRef.current = true;
      refreshPhase();
      if (endTimer) window.clearTimeout(endTimer);
      // Final result with no interim tail: the customer has most likely finished the sentence.
      endTimer = window.setTimeout(() => {
        const text = `${finalText}${interim}`.trim();
        finalText = "";
        hearingRef.current = false;
        const assistantSaid = heardOverEcho ? recentSpeechRef.current : undefined;
        heardOverEcho = false;
        if (text) void handleUtterance({ transcript: text, durationMs: 0, assistantSaid });
        else refreshPhase();
      }, interim ? 2200 : 1300);
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access was blocked. Allow it in your browser to talk to the assistant.");
        stopRef.current();
      }
    };
    recognition.onend = () => {
      recognitionRunningRef.current = false;
      // Chrome ends recognition after a stretch of silence: restart while we should be listening.
      window.setTimeout(syncRecognition, 150);
    };
    recognitionRef.current = recognition;
  }, [handleUtterance, interrupt, refreshPhase, syncRecognition]);

  // --- lifecycle -----------------------------------------------------------------------------

  const teardown = useCallback(() => {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    if (sessionTimerRef.current) window.clearTimeout(sessionTimerRef.current);
    if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = null;
    idleTimerRef.current = null;
    sessionTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    recognitionRunningRef.current = false;
    if (recognition) {
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        // Already stopped.
      }
    }
    vadRef.current.inSpeech = false;
    vadRef.current.chunks = [];
    hearingRef.current = false;
    setLevel(0);
    setLiveText("");
  }, []);

  const stop = useCallback(() => {
    turnRef.current?.controller.abort();
    turnRef.current = null;
    stopPlayback();
    teardown();
    setPhase("off");
  }, [setPhase, stopPlayback, teardown]);

  const stopRef = useRef(stop);
  stopRef.current = stop;
  stopAfterSpeechRef.current = () => {
    endAfterSpeechRef.current = false;
    stop();
  };

  /** Let the current reply finish, then end the session (it ends at once if nothing is playing). */
  const finishAfterSpeech = useCallback(() => {
    endAfterSpeechRef.current = true;
    // Give a reply that's still streaming in a moment to start; then the next idle moment ends it.
    window.setTimeout(() => {
      if (endAfterSpeechRef.current && !playingRef.current && !turnRef.current && queueRef.current.length === 0) {
        stopAfterSpeechRef.current();
      }
    }, 4000);
  }, []);

  const pause = useCallback(() => {
    if (phaseRef.current === "off") return;
    turnRef.current?.controller.abort();
    turnRef.current = null;
    stopPlayback();
    hearingRef.current = false;
    vadRef.current.inSpeech = false;
    setPhase("paused");
    syncRecognition();
  }, [setPhase, stopPlayback, syncRecognition]);
  pauseRef.current = pause;

  const resume = useCallback(() => {
    if (phaseRef.current !== "paused") return;
    setPhase("listening");
    resetIdleTimer();
    if (configRef.current.speech === "browser") syncRecognition();
  }, [resetIdleTimer, setPhase, syncRecognition]);

  /**
   * Unlocks audio playback. Call synchronously inside the click/tap that starts voice, before any
   * await, so replies can play later without a fresh gesture (iOS Safari, autoplay rules).
   */
  const prime = useCallback(() => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.src = URL.createObjectURL(encodeWav([new Float32Array(1600)], 16_000));
    audio.play().catch(() => undefined);
    if ("speechSynthesis" in window) window.speechSynthesis.resume();
  }, []);

  /** Call from a click/tap handler (after prime): asks for the microphone and starts listening. */
  const start = useCallback(
    async (startOptions: StartOptions) => {
      if (phaseRef.current !== "off") return true;
      configRef.current = startOptions;
      endAfterSpeechRef.current = false;
      setLangState(startOptions.lang);
      setError(null);
      setPhase("starting");

      if (!audioRef.current) prime();

      try {
        if (startOptions.speech === "server") await startServerCapture();
        else startBrowserRecognition();
      } catch (caught) {
        teardown();
        setPhase("off");
        const denied = caught instanceof DOMException && (caught.name === "NotAllowedError" || caught.name === "SecurityError");
        setError(
          denied
            ? "Microphone access was blocked. Allow it in your browser to talk to the assistant."
            : "Voice isn't supported in this browser. You can keep chatting by text.",
        );
        return false;
      }

      sessionTimerRef.current = window.setTimeout(() => stopRef.current(), startOptions.maxSessionMinutes * 60_000);
      setPhase("listening");
      resetIdleTimer();
      if (startOptions.speech === "browser") syncRecognition();
      return true;
    },
    [prime, resetIdleTimer, setPhase, startBrowserRecognition, startServerCapture, syncRecognition, teardown],
  );

  const setLang = useCallback(
    (next: VoiceLang) => {
      configRef.current = { ...configRef.current, lang: next };
      setLangState(next);
      // Restart recognition so the new language takes effect.
      if (recognitionRunningRef.current) {
        recognitionRunningRef.current = false;
        try {
          recognitionRef.current?.abort();
        } catch {
          // onend restarts it.
        }
      }
    },
    [],
  );

  useEffect(() => () => stopRef.current(), []);

  return {
    phase,
    level,
    liveText,
    error,
    lang,
    active: phase !== "off",
    prime,
    finishAfterSpeech,
    start,
    stop,
    pause,
    resume,
    interrupt,
    say,
    submitText,
    setLang,
    clearError: () => setError(null),
  };
}
