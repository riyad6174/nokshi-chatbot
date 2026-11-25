"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeCallbacks } from "@/components/chat/useRealtimeVoice";
import type { SpokenSentence, VoiceLang, VoicePhase } from "@/components/chat/useVoiceSession";
import { hasSpeechText, isLikelyEcho, isNoiseTranscript } from "@/modules/speech/echo";
import type { ChatMessage, ChatPart } from "@/types/chat";

// Live voice over the Gemini Live API (WebSocket). One streaming model hears the customer, decides
// and speaks. The browser streams 16 kHz PCM from the microphone and plays the 24 kHz PCM reply;
// tools still run on our server (/realtime/tool), so cart, stock and order rules are exactly the same
// as in text chat. Same surface as useVoiceSession / useRealtimeVoice, so the widget works with any engine.

type StartOptions = { lang: VoiceLang; maxSessionMinutes: number };
type Grant = { token: string; wsUrl: string; model: string; opener: string; expiresAt: number };
type HeldGrant = Grant & { receivedAt: number };
type FunctionCall = { id?: string; name: string; args?: Record<string, unknown> };
type ServerMessage = {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: Array<{ text?: string; thought?: boolean; inlineData?: { mimeType?: string; data?: string } }> };
    turnComplete?: boolean;
    interrupted?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
  };
  toolCall?: { functionCalls?: FunctionCall[] };
  toolCallCancellation?: { ids?: string[] };
  usageMetadata?: Record<string, unknown>;
  goAway?: { timeLeft?: string };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
};

const IDLE_PAUSE_MS = 3 * 60_000;
/** Tokens can start a call for 10 minutes; a pre-fetched one is used while it has ~2 minutes left. */
const GRANT_USABLE_MS = 8 * 60_000;
const INPUT_RATE = 16_000;
const OUTPUT_RATE = 24_000;
/**
 * While the assistant is audible, the microphone is held back until the customer clearly talks over
 * it: this loud, for this many 40 ms chunks in a row. The browser's echo cancellation removes most of
 * the assistant's own voice, but on laptop and phone speakers the rest (and background noise) kept
 * interrupting replies, which then started over: the "same sentence again and again" complaint.
 */
const BARGE_IN_RMS = 0.05;
const BARGE_IN_CHUNKS = 3;
/** Audio kept while held back, sent first when a real barge-in starts (so its first syllables count). */
const BARGE_IN_LOOKBACK_CHUNKS = 8;
/** Quiet chunks after which a barge-in that turned out to be noise closes again. */
const BARGE_IN_RELEASE_CHUNKS = 12;
/** A typed line on a call can come back from Gemini as if it was heard; it's ignored for this long. */
const TYPED_ECHO_MS = 15_000;
/** Customer words are saved this long after the last transcript fragment (fragments arrive in bursts). */
const USER_FLUSH_MS = 350;

// Downsamples the microphone to 16 kHz 16-bit PCM in 40 ms chunks, with the chunk's loudness.
const CAPTURE_WORKLET = `
class GeminiCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${INPUT_RATE};
    this.pos = 0; this.sum = 0; this.n = 0; this.energy = 0; this.count = 0;
    this.out = new Int16Array(640); this.o = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const s = channel[i];
      this.sum += s; this.n++; this.energy += s * s; this.count++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.sum / this.n));
        this.sum = 0; this.n = 0;
        this.out[this.o++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        if (this.o === this.out.length) {
          const rms = Math.sqrt(this.energy / Math.max(1, this.count));
          this.energy = 0; this.count = 0;
          this.port.postMessage({ pcm: this.out.buffer, rms }, [this.out.buffer]);
          this.out = new Int16Array(640); this.o = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("gemini-capture", GeminiCapture);
`;

function startErrorMessage(caught: unknown): string {
  if (caught instanceof DOMException) {
    if (caught.name === "NotAllowedError" || caught.name === "SecurityError") {
      return "Microphone access was blocked. Allow it in your browser to talk to the assistant.";
    }
    if (caught.name === "NotFoundError" || caught.name === "OverconstrainedError") {
      return "No microphone was found. Connect one, or tap Type to chat instead.";
    }
    if (caught.name === "NotReadableError") return "Your microphone is busy in another app. Close it and try again.";
    return "Voice isn't available in this browser. Tap Type to chat instead.";
  }
  return caught instanceof Error && caught.message ? caught.message : "Live voice couldn't start. You can keep chatting by text.";
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!response.ok || !data) throw new Error(data?.error?.message || "The request failed.");
  return data;
}

/** Same words, ignoring case, punctuation and spacing (a typed line vs. its transcript). */
function sameWords(left: string, right: string): boolean {
  const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return norm(left) === norm(right);
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function pcm16ToFloat(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const samples = new Float32Array(new ArrayBuffer((binary.length >> 1) * 4));
  for (let i = 0; i < samples.length; i++) {
    const lo = binary.charCodeAt(i * 2);
    const hi = binary.charCodeAt(i * 2 + 1);
    const value = (hi << 8) | lo;
    samples[i] = (value >= 0x8000 ? value - 0x10000 : value) / 0x8000;
  }
  return samples;
}

let preconnected = false;
function preconnectToGemini() {
  if (preconnected || typeof document === "undefined") return;
  preconnected = true;
  const link = document.createElement("link");
  link.rel = "preconnect";
  link.href = "https://generativelanguage.googleapis.com";
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}

type Reply = { id: string; text: string; interrupted: boolean; muted: boolean };

export function useGeminiLiveVoice(callbacks: RealtimeCallbacks) {
  const [phase, setPhaseState] = useState<VoicePhase>("off");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLangState] = useState<VoiceLang>("bn");
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const phaseRef = useRef<VoicePhase>("off");
  const wsRef = useRef<WebSocket | null>(null);
  /** The socket finished setup and can take audio. */
  const readyRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<{ source: MediaStreamAudioSourceNode; node: AudioWorkletNode; sink: GainNode } | null>(null);
  const playbackRef = useRef<{ nextTime: number; sources: Set<AudioBufferSourceNode> }>({ nextTime: 0, sources: new Set() });
  const replyRef = useRef<Reply | null>(null);
  /** The latest reply's id, kept after it ends: its usage report can arrive just after. */
  const lastReplyIdRef = useRef<string | null>(null);
  const lastSaidRef = useRef("");
  const userTextRef = useRef("");
  const userStartedAtRef = useRef(0);
  const userFlushTimerRef = useRef<number | null>(null);
  const pendingUserRef = useRef<Promise<unknown>>(Promise.resolve());
  const toolsRunningRef = useRef<Map<string, Promise<void>>>(new Map());
  const cancelledCallsRef = useRef<Set<string>>(new Set());
  const resumeHandleRef = useRef<string | null>(null);
  const reconnectingRef = useRef(false);
  const callIdRef = useRef("");
  const usageCountRef = useRef(0);
  const modelRef = useRef("");
  const idleTimerRef = useRef<number | null>(null);
  const sessionTimerRef = useRef<number | null>(null);
  const endAfterSpeechRef = useRef(false);
  const levelTickRef = useRef(0);
  /** The barge-in gate while the assistant speaks (see BARGE_IN_RMS). */
  const gateRef = useRef<{ open: boolean; loud: number; quiet: number; held: ArrayBuffer[] }>({ open: false, loud: 0, quiet: 0, held: [] });
  /** The latest typed line on this call, to drop it when Gemini sends it back as a transcript. */
  const typedRef = useRef<{ text: string; at: number } | null>(null);

  const setPhase = useCallback((next: VoicePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const send = useCallback((message: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }, []);

  const pauseRef = useRef<() => void>(() => undefined);
  const stopRef = useRef<() => void>(() => undefined);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      if (phaseRef.current === "listening") pauseRef.current();
    }, IDLE_PAUSE_MS);
  }, []);

  const isPlaying = () => {
    const ctx = audioCtxRef.current;
    return Boolean(ctx && playbackRef.current.sources.size > 0 && ctx.currentTime < playbackRef.current.nextTime + 0.4);
  };

  const toListening = useCallback(() => {
    if (endAfterSpeechRef.current && !replyRef.current) {
      stopRef.current();
      return;
    }
    if (phaseRef.current === "paused" || phaseRef.current === "off") return;
    if (replyRef.current) {
      // Still mid-reply (e.g. a tool is running): the assistant is working, not listening.
      if (phaseRef.current !== "hearing") setPhase("thinking");
      return;
    }
    setPhase("listening");
    resetIdleTimer();
  }, [resetIdleTimer, setPhase]);

  // --- playback ------------------------------------------------------------------------------

  const stopPlayback = useCallback(() => {
    const playback = playbackRef.current;
    for (const source of playback.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    playback.sources.clear();
    playback.nextTime = 0;
  }, []);

  const playChunk = useCallback(
    (base64: string) => {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const samples = pcm16ToFloat(base64);
      if (samples.length === 0) return;
      const buffer = ctx.createBuffer(1, samples.length, OUTPUT_RATE);
      buffer.copyToChannel(samples, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      const playback = playbackRef.current;
      // A small lead on the first chunk absorbs network jitter without a noticeable delay.
      const startAt = Math.max(ctx.currentTime + 0.04, playback.nextTime);
      source.start(startAt);
      playback.nextTime = startAt + buffer.duration;
      playback.sources.add(source);
      source.onended = () => {
        playback.sources.delete(source);
        if (playback.sources.size === 0) toListening();
      };
      if (phaseRef.current !== "paused" && phaseRef.current !== "speaking") setPhase("speaking");
    },
    [setPhase, toListening],
  );

  // --- customer words ------------------------------------------------------------------------

  /** Saves what the customer said (unless it's the assistant's own voice coming back). */
  const flushUser = useCallback(() => {
    if (userFlushTimerRef.current) window.clearTimeout(userFlushTimerRef.current);
    userFlushTimerRef.current = null;
    const text = userTextRef.current.trim();
    userTextRef.current = "";
    if (!hasSpeechText(text)) return;
    // Noise or echo transcribed as stray words ("¿Qué", "de", "A"): not the customer, never saved.
    if (isNoiseTranscript(text)) return;
    if (isLikelyEcho(text, `${lastSaidRef.current} ${replyRef.current?.text ?? ""}`)) return;
    // A line the customer typed on the call, sent back by Gemini as if it was heard: already saved.
    const typed = typedRef.current;
    if (typed && performance.now() - typed.at < TYPED_ECHO_MS && sameWords(typed.text, text)) {
      typedRef.current = null;
      return;
    }
    pendingUserRef.current = postJson<{ message: ChatMessage | null }>("/api/widget/voice/realtime/transcript", { role: "user", text })
      .then((saved) => saved.message && callbacksRef.current.onUserMessage(saved.message))
      .catch(() => undefined);
  }, []);

  // --- replies -------------------------------------------------------------------------------

  const ensureReply = useCallback((): Reply => {
    if (!replyRef.current) {
      const id = `voice-${Date.now()}`;
      replyRef.current = { id, text: "", interrupted: false, muted: false };
      lastReplyIdRef.current = id;
      callbacksRef.current.onReplyStart(id);
    }
    return replyRef.current;
  }, []);

  const finishReply = useCallback(async () => {
    const reply = replyRef.current;
    replyRef.current = null;
    if (!reply) return;
    if (reply.text.trim()) lastSaidRef.current = reply.text.trim();
    flushUser();
    await pendingUserRef.current.catch(() => undefined);
    await Promise.all(toolsRunningRef.current.values()).catch(() => undefined);
    try {
      const saved = await postJson<{ message: ChatMessage | null }>("/api/widget/voice/realtime/transcript", {
        role: "assistant",
        text: reply.text.trim(),
        interrupted: reply.interrupted,
        replyKey: reply.id,
      });
      callbacksRef.current.onReplyDone(reply.id, saved.message);
    } catch {
      callbacksRef.current.onReplyDone(reply.id, null);
    }
  }, [flushUser]);

  const runTool = useCallback(
    async (call: FunctionCall) => {
      const replyId = ensureReply().id;
      const callId = call.id ?? `${call.name}-${Date.now()}`;
      setActiveTool(call.name);
      let output: string;
      try {
        const result = await postJson<{ output: string; ui: ChatPart[] }>("/api/widget/voice/realtime/tool", {
          name: call.name,
          arguments: JSON.stringify(call.args ?? {}),
          speechAgoMs: userStartedAtRef.current ? Math.min(600_000, Math.round(performance.now() - userStartedAtRef.current)) : undefined,
        });
        output = result.output;
        for (const part of result.ui) callbacksRef.current.onReplyPart(replyId, part);
      } catch (caught) {
        output = JSON.stringify({ ok: false, error: { code: "tool_failed", message: caught instanceof Error ? caught.message : "failed" } });
      } finally {
        setActiveTool((current) => (current === call.name ? null : current));
      }
      if (cancelledCallsRef.current.delete(callId)) return;
      let response: Record<string, unknown>;
      try {
        const parsed = JSON.parse(output) as unknown;
        response = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { result: parsed };
      } catch {
        response = { result: output };
      }
      send({ toolResponse: { functionResponses: [{ id: call.id, name: call.name, response }] } });
      // The customer is done: hang up once the goodbye has been spoken (see toListening), or after a
      // short wait if no goodbye comes.
      if (call.name === "end_call" && response.ok !== false) {
        endAfterSpeechRef.current = true;
        window.setTimeout(() => {
          if (endAfterSpeechRef.current && !isPlaying() && !replyRef.current) stopRef.current();
        }, 10_000);
      }
    },
    [ensureReply, send],
  );

  const onServerMessage = useCallback(
    (message: ServerMessage) => {
      const content = message.serverContent;
      if (content) {
        const heard = content.inputTranscription?.text;
        if (heard) {
          if (!userTextRef.current) userStartedAtRef.current = performance.now();
          userTextRef.current += heard;
          if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
          if (!replyRef.current && phaseRef.current === "listening") setPhase("hearing");
          if (userFlushTimerRef.current) window.clearTimeout(userFlushTimerRef.current);
          userFlushTimerRef.current = window.setTimeout(flushUser, USER_FLUSH_MS);
        }
        if (content.interrupted) {
          // The customer started talking: the model stopped; stop what's still queued to play.
          stopPlayback();
          if (replyRef.current) {
            replyRef.current.interrupted = true;
            void finishReply();
          }
          if (phaseRef.current !== "paused") setPhase("hearing");
        }
        const parts = content.modelTurn?.parts ?? [];
        for (const part of parts) {
          if (part.thought) continue;
          const audio = part.inlineData?.data;
          if (!audio || !part.inlineData?.mimeType?.startsWith("audio/")) continue;
          const reply = ensureReply();
          if (!reply.muted && phaseRef.current !== "paused") playChunk(audio);
        }
        const said = content.outputTranscription?.text;
        if (said) {
          const reply = ensureReply();
          if (!reply.muted) {
            reply.text += said;
            callbacksRef.current.onReplyDelta(reply.id, said);
          }
        }
        if (content.turnComplete) {
          flushUser();
          // A turn can end while its tools still run; the continuation ends with its own turnComplete.
          if (replyRef.current && toolsRunningRef.current.size === 0) void finishReply();
          if (!isPlaying()) toListening();
        }
      }

      const calls = message.toolCall?.functionCalls ?? [];
      if (calls.length > 0) {
        flushUser();
        ensureReply();
        if (phaseRef.current !== "paused" && !isPlaying()) setPhase("thinking");
        for (const call of calls) {
          const key = call.id ?? `${call.name}-${Date.now()}`;
          const promise = runTool(call).finally(() => toolsRunningRef.current.delete(key));
          toolsRunningRef.current.set(key, promise);
        }
      }
      for (const id of message.toolCallCancellation?.ids ?? []) cancelledCallsRef.current.add(id);

      if (message.usageMetadata) {
        usageCountRef.current += 1;
        void postJson("/api/widget/voice/realtime/usage", {
          kind: "gemini",
          responseId: `${callIdRef.current}-${usageCountRef.current}`,
          replyKey: replyRef.current?.id ?? lastReplyIdRef.current ?? undefined,
          model: modelRef.current,
          usage: message.usageMetadata,
        }).catch(() => undefined);
      }
      const update = message.sessionResumptionUpdate;
      if (update?.resumable && update.newHandle) resumeHandleRef.current = update.newHandle;
      if (message.goAway) void reconnectRef.current();
    },
    [ensureReply, finishReply, flushUser, playChunk, runTool, setPhase, stopPlayback, toListening],
  );

  // --- connection ----------------------------------------------------------------------------

  const grantRef = useRef<HeldGrant | null>(null);
  const grantLoadRef = useRef<Promise<HeldGrant> | null>(null);
  const fetchGrant = useCallback((resumeHandle?: string): Promise<HeldGrant> => {
    const load = () =>
      postJson<Grant>("/api/widget/voice/gemini/session", resumeHandle ? { resumeHandle } : {}).then((grant) => ({
        ...grant,
        receivedAt: Date.now(),
      }));
    if (resumeHandle) return load();
    grantLoadRef.current ??= load()
      .then((held) => {
        grantRef.current = held;
        return held;
      })
      .finally(() => {
        grantLoadRef.current = null;
      });
    return grantLoadRef.current;
  }, []);
  const takeFreshGrant = () => {
    const grant = grantRef.current;
    grantRef.current = null; // One call per token.
    return grant && Date.now() - grant.receivedAt < GRANT_USABLE_MS ? grant : null;
  };

  /** Opens the socket and waits for setupComplete. */
  const connect = useCallback(
    (grant: Grant): Promise<WebSocket> =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`${grant.wsUrl}?access_token=${encodeURIComponent(grant.token)}`);
        ws.binaryType = "arraybuffer";
        const decoder = new TextDecoder();
        let settled = false;
        const timer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          ws.close();
          reject(new Error("The voice service didn't answer. Check your connection and try again."));
        }, 15_000);
        ws.onopen = () => ws.send(JSON.stringify({ setup: { model: `models/${grant.model}` } }));
        ws.onmessage = (event) => {
          let message: ServerMessage;
          try {
            message = JSON.parse(typeof event.data === "string" ? event.data : decoder.decode(event.data as ArrayBuffer)) as ServerMessage;
          } catch {
            return;
          }
          if (!settled && message.setupComplete !== undefined) {
            settled = true;
            window.clearTimeout(timer);
            resolve(ws);
            return;
          }
          if (wsRef.current === ws) onServerMessage(message);
        };
        ws.onclose = (event) => {
          if (!settled) {
            settled = true;
            window.clearTimeout(timer);
            console.warn("gemini live closed during setup:", event.code, event.reason);
            reject(new Error("The voice service refused the call. Please try again in a moment."));
            return;
          }
          if (wsRef.current !== ws || reconnectingRef.current) return;
          if (event.code !== 1000) console.warn("gemini live closed:", event.code, event.reason);
          // The server ended the connection without warning: try to continue the same conversation.
          if (resumeHandleRef.current && phaseRef.current !== "off") {
            void reconnectRef.current();
            return;
          }
          setError("The voice call was disconnected. Tap Talk to start again.");
          stopRef.current();
        };
      }),
    [onServerMessage],
  );

  /** The server rotates connections (goAway): reconnect to the same conversation, mic kept open. */
  const reconnectRef = useRef<() => Promise<void>>(async () => undefined);
  reconnectRef.current = async () => {
    const handle = resumeHandleRef.current;
    if (reconnectingRef.current || phaseRef.current === "off") return;
    if (!handle) return; // The current connection keeps working until it closes.
    reconnectingRef.current = true;
    readyRef.current = false;
    const old = wsRef.current;
    try {
      const grant = await fetchGrant(handle);
      const ws = await connect(grant);
      wsRef.current = ws;
      readyRef.current = true;
      old?.close(1000);
    } catch {
      setError("The voice call was disconnected. Tap Talk to start again.");
      stopRef.current();
    } finally {
      reconnectingRef.current = false;
    }
  };

  const startCapture = useCallback(
    async (ctx: AudioContext, mic: MediaStream) => {
      const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const source = ctx.createMediaStreamSource(mic);
      const node = new AudioWorkletNode(ctx, "gemini-capture");
      // Keeps the worklet running; silent, so the customer doesn't hear themselves.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);
      node.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
        const { pcm, rms } = event.data;
        const now = performance.now();
        if (now - levelTickRef.current > 80) {
          levelTickRef.current = now;
          setLevel(Math.min(1, rms * 10));
        }
        if (!readyRef.current || phaseRef.current === "paused" || phaseRef.current === "off") return;
        const sendChunk = (chunk: ArrayBuffer) =>
          send({ realtimeInput: { audio: { data: toBase64(chunk), mimeType: `audio/pcm;rate=${INPUT_RATE}` } } });
        const gate = gateRef.current;
        if (!isPlaying()) {
          gate.open = false;
          gate.loud = 0;
          gate.quiet = 0;
          gate.held = [];
          sendChunk(pcm);
          return;
        }
        // The assistant is audible: hold the microphone back until the customer clearly talks over it.
        if (!gate.open) {
          gate.held.push(pcm);
          if (gate.held.length > BARGE_IN_LOOKBACK_CHUNKS) gate.held.shift();
          gate.loud = rms >= BARGE_IN_RMS ? gate.loud + 1 : 0;
          if (gate.loud < BARGE_IN_CHUNKS) return;
          gate.open = true;
          gate.quiet = 0;
          for (const chunk of gate.held) sendChunk(chunk);
          gate.held = [];
          return;
        }
        // Talking over the assistant: send everything, until it goes quiet again (it was noise).
        gate.quiet = rms < BARGE_IN_RMS ? gate.quiet + 1 : 0;
        if (gate.quiet >= BARGE_IN_RELEASE_CHUNKS) {
          gate.open = false;
          gate.loud = 0;
        }
        sendChunk(pcm);
      };
      captureRef.current = { source, node, sink };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isPlaying only reads refs
    [send],
  );

  // --- start / stop --------------------------------------------------------------------------

  const teardown = useCallback(() => {
    for (const timer of [idleTimerRef, sessionTimerRef, userFlushTimerRef]) {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
    }
    readyRef.current = false;
    reconnectingRef.current = false;
    resumeHandleRef.current = null;
    lastSaidRef.current = "";
    userTextRef.current = "";
    cancelledCallsRef.current.clear();
    stopPlayback();
    const ws = wsRef.current;
    wsRef.current = null;
    ws?.close(1000);
    if (captureRef.current) {
      captureRef.current.node.port.onmessage = null;
      captureRef.current.source.disconnect();
      captureRef.current.node.disconnect();
      captureRef.current.sink.disconnect();
      captureRef.current = null;
    }
    micRef.current?.getTracks().forEach((track) => track.stop());
    micRef.current = null;
    setLevel(0);
    setActiveTool(null);
  }, [stopPlayback]);

  const stop = useCallback(() => {
    endAfterSpeechRef.current = false;
    flushUser();
    if (replyRef.current) {
      replyRef.current.interrupted = replyRef.current.interrupted || isPlaying();
      void finishReply();
    }
    teardown();
    setPhase("off");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isPlaying only reads refs
  }, [finishReply, flushUser, setPhase, teardown]);
  stopRef.current = stop;

  const warmUp = useCallback(() => {
    preconnectToGemini();
    if (phaseRef.current !== "off" || grantLoadRef.current) return;
    const held = grantRef.current;
    if (held && Date.now() - held.receivedAt < GRANT_USABLE_MS) return;
    fetchGrant().catch(() => undefined);
  }, [fetchGrant]);

  /** Call synchronously inside the click that starts voice, before any await (autoplay rules). */
  const prime = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      try {
        audioCtxRef.current = new AudioContext({ latencyHint: "interactive" });
      } catch {
        return;
      }
    }
    void audioCtxRef.current.resume().catch(() => undefined);
  }, []);

  const start = useCallback(
    async (options: StartOptions) => {
      if (phaseRef.current !== "off") return true;
      setError(null);
      setLangState(options.lang);
      endAfterSpeechRef.current = false;
      setPhase("starting");
      prime();
      callIdRef.current = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      usageCountRef.current = 0;

      try {
        preconnectToGemini();
        const ready = takeFreshGrant();
        const [grantResult, micResult] = await Promise.allSettled([
          ready ? Promise.resolve(ready) : (grantLoadRef.current ?? fetchGrant()).then((grant) => (takeFreshGrant(), grant)),
          navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
          }),
        ]);
        if (micResult.status === "fulfilled") micRef.current = micResult.value;
        if (micResult.status === "rejected") throw micResult.reason;
        if (grantResult.status === "rejected") throw grantResult.reason;
        const ctx = audioCtxRef.current;
        if (!ctx) throw new Error("Voice isn't available in this browser. Tap Type to chat instead.");

        let grant: Grant = grantResult.value;
        const [ws] = await Promise.all([
          connect(grant).catch(async (caught) => {
            // A pre-fetched token may have been used or expired: one retry with a fresh one.
            if (grant !== ready) throw caught;
            grant = await fetchGrant();
            takeFreshGrant();
            return connect(grant);
          }),
          startCapture(ctx, micRef.current!),
        ]);
        wsRef.current = ws;
        modelRef.current = grant.model;
        readyRef.current = true;

        sessionTimerRef.current = window.setTimeout(() => stopRef.current(), options.maxSessionMinutes * 60_000);
        setPhase("thinking");
        // The assistant speaks first: "Hello! How can I help you?" (by name when known).
        send({ clientContent: { turns: [{ role: "user", parts: [{ text: grant.opener }] }], turnComplete: true } });
        return true;
      } catch (caught) {
        teardown();
        setPhase("off");
        setError(startErrorMessage(caught));
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- takeFreshGrant only reads refs
    [connect, fetchGrant, prime, send, setPhase, startCapture, teardown],
  );

  // --- controls ------------------------------------------------------------------------------

  const setMicEnabled = (enabled: boolean) => micRef.current?.getAudioTracks().forEach((track) => (track.enabled = enabled));

  /** Stops the assistant mid-reply so the customer can talk. */
  const interrupt = useCallback(() => {
    stopPlayback();
    const reply = replyRef.current;
    if (reply) {
      reply.interrupted = true;
      // Gemini has no "cancel": the rest of this reply is dropped as it streams in.
      reply.muted = true;
    }
  }, [stopPlayback]);

  const pause = useCallback(() => {
    if (phaseRef.current === "off") return;
    interrupt();
    setMicEnabled(false);
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    setPhase("paused");
  }, [interrupt, setPhase]);
  pauseRef.current = pause;

  const resume = useCallback(() => {
    if (phaseRef.current !== "paused") return;
    setMicEnabled(true);
    setPhase("listening");
    resetIdleTimer();
  }, [resetIdleTimer, setPhase]);

  const say = useCallback(
    (sentence: SpokenSentence) => {
      send({
        clientContent: {
          turns: [{ role: "user", parts: [{ text: `(System) Say this to the customer, naturally and briefly, in the same language: "${sentence.text}"` }] }],
          turnComplete: true,
        },
      });
    },
    [send],
  );

  const submitText = useCallback(
    async (text: string) => {
      pendingUserRef.current = postJson<{ message: ChatMessage | null }>("/api/widget/voice/realtime/transcript", { role: "user", text })
        .then((saved) => saved.message && callbacksRef.current.onUserMessage(saved.message))
        .catch(() => undefined);
      userStartedAtRef.current = performance.now();
      typedRef.current = { text, at: performance.now() };
      send({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } });
    },
    [send],
  );

  const setLang = useCallback(
    (next: VoiceLang) => {
      setLangState(next);
      send({
        clientContent: {
          turns: [{ role: "user", parts: [{ text: next === "bn" ? "(System) The customer prefers Bangla. Reply in Bangla from now on." : "(System) The customer prefers English. Reply in English from now on." }] }],
          turnComplete: false,
        },
      });
    },
    [send],
  );

  /** Tells the model something about the page (e.g. the customer opened a product page), without a reply. */
  const notePage = useCallback(
    (text: string) => {
      send({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: false } });
    },
    [send],
  );

  const finishAfterSpeech = useCallback(() => {
    endAfterSpeechRef.current = true;
    window.setTimeout(() => {
      if (endAfterSpeechRef.current && !isPlaying() && !replyRef.current) stopRef.current();
    }, 6000);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isPlaying only reads refs
  }, []);

  useEffect(
    () => () => {
      stopRef.current();
      void audioCtxRef.current?.close().catch(() => undefined);
      audioCtxRef.current = null;
    },
    [],
  );

  return {
    phase,
    level,
    liveText: "",
    activeTool,
    error,
    lang,
    active: phase !== "off",
    prime,
    warmUp,
    finishAfterSpeech,
    start,
    stop,
    pause,
    resume,
    interrupt,
    say,
    submitText,
    setLang,
    notePage,
    clearError: () => setError(null),
  };
}
