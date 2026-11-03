"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SpokenSentence, VoiceLang, VoicePhase } from "@/components/chat/useVoiceSession";
import type { ChatMessage, ChatPart } from "@/types/chat";

// Live voice over the OpenAI Realtime API (WebRTC). One streaming model hears the customer, decides
// and speaks: no recording/upload/transcribe/synthesize steps, built-in echo cancellation, and it
// stops talking the moment the customer speaks. Tools still run on our server (/realtime/tool), so
// cart, stock and order rules are exactly the same as in text chat.
//
// Same surface as useVoiceSession, so the widget, controls and orb work with either engine.

export type RealtimeCallbacks = {
  /** A customer utterance was transcribed and saved. */
  onUserMessage: (message: ChatMessage) => void;
  /** The assistant started a reply: show an empty assistant message to fill. */
  onReplyStart: (replyId: string) => void;
  /** Live caption text of the reply as it's spoken. */
  onReplyDelta: (replyId: string, text: string) => void;
  /** A card (products, cart, order summary) a tool produced during this reply. */
  onReplyPart: (replyId: string, part: ChatPart) => void;
  /** The reply was saved; swap the live message for the stored one (null: nothing to keep). */
  onReplyDone: (replyId: string, message: ChatMessage | null) => void;
};

type StartOptions = { lang: VoiceLang; maxSessionMinutes: number };

/** Pause after this long with nobody talking, so the mic isn't left open. */
const IDLE_PAUSE_MS = 20_000;
const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

type ServerEvent = { type: string; [key: string]: unknown };
type FunctionCallItem = { type: "function_call"; call_id: string; name: string; arguments: string };

/** What to tell the customer when a call can't start. Browser errors ("Not supported") are cryptic. */
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

type Grant = { clientSecret: string; opener: string; expiresAt: number };
/** A grant plus when this browser received it (the customer's clock can be off from OpenAI's). */
type HeldGrant = Grant & { receivedAt: number };

/** Tokens live 10 minutes; a pre-fetched one is used only while it has at least ~1.5 minutes left. */
const GRANT_USABLE_MS = 8 * 60_000;
/** A dropped connection often comes back by itself (Wi-Fi/mobile hand-over); wait this long first. */
const RECONNECT_GRACE_MS = 8_000;

let preconnected = false;
/** Opens the TLS connection to OpenAI early, so the call's handshake doesn't pay for it. */
function preconnectToOpenAi() {
  if (preconnected || typeof document === "undefined") return;
  preconnected = true;
  const link = document.createElement("link");
  link.rel = "preconnect";
  link.href = new URL(REALTIME_CALLS_URL).origin;
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!response.ok || !data) throw new Error(data?.error?.message || "The request failed.");
  return data;
}

export function useRealtimeVoice(callbacks: RealtimeCallbacks) {
  const [phase, setPhaseState] = useState<VoicePhase>("off");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLangState] = useState<VoiceLang>("bn");

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const phaseRef = useRef<VoicePhase>("off");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const meterRef = useRef<{ context: AudioContext; frame: number } | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const sessionTimerRef = useRef<number | null>(null);
  const speechStartedAtRef = useRef(0);
  const speakingRef = useRef(false);
  const endAfterSpeechRef = useRef(false);
  /** The reply being spoken: id for the UI, its transcript, and whether it was cut off. */
  const replyRef = useRef<{ id: string; text: string; interrupted: boolean } | null>(null);
  /** Customer transcripts still being saved, so a reply is stored after the words it answers. */
  const pendingUserRef = useRef<Promise<unknown>>(Promise.resolve());
  const toolsRunningRef = useRef<Map<string, Promise<void>>>(new Map());
  const dropTimerRef = useRef<number | null>(null);

  const setPhase = useCallback((next: VoicePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const send = useCallback((event: Record<string, unknown>) => {
    const channel = channelRef.current;
    if (channel?.readyState === "open") channel.send(JSON.stringify(event));
  }, []);

  // --- lifecycle helpers ---------------------------------------------------------------------

  const pauseRef = useRef<() => void>(() => undefined);
  const stopRef = useRef<() => void>(() => undefined);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      if (phaseRef.current === "listening") pauseRef.current();
    }, IDLE_PAUSE_MS);
  }, []);

  const toListening = useCallback(() => {
    if (endAfterSpeechRef.current) {
      stopRef.current();
      return;
    }
    if (phaseRef.current === "paused" || phaseRef.current === "off") return;
    setPhase("listening");
    resetIdleTimer();
  }, [resetIdleTimer, setPhase]);

  // --- replies -------------------------------------------------------------------------------

  const finishReply = useCallback(async () => {
    const reply = replyRef.current;
    replyRef.current = null;
    if (!reply) return;
    // Store the customer's words first, so the chat and the AI's memory keep the right order.
    await pendingUserRef.current.catch(() => undefined);
    await Promise.all(toolsRunningRef.current.values()).catch(() => undefined);
    try {
      const saved = await postJson<{ message: ChatMessage | null }>("/api/widget/voice/realtime/transcript", {
        role: "assistant",
        text: reply.text.trim(),
        interrupted: reply.interrupted,
      });
      callbacksRef.current.onReplyDone(reply.id, saved.message);
    } catch {
      callbacksRef.current.onReplyDone(reply.id, null);
    }
  }, []);

  const runTool = useCallback(
    async (call: FunctionCallItem) => {
      const replyId = replyRef.current?.id ?? `voice-${Date.now()}`;
      let output: string;
      try {
        const result = await postJson<{ output: string; ui: ChatPart[]; instructions: string | null }>(
          "/api/widget/voice/realtime/tool",
          {
            name: call.name,
            arguments: call.arguments || "{}",
            speechAgoMs: speechStartedAtRef.current ? Math.round(performance.now() - speechStartedAtRef.current) : undefined,
          },
        );
        output = result.output;
        for (const part of result.ui) callbacksRef.current.onReplyPart(replyId, part);
        // The cart or order changed: refresh the "next step" the model follows.
        if (result.instructions) send({ type: "session.update", session: { type: "realtime", instructions: result.instructions } });
      } catch (caught) {
        output = JSON.stringify({ ok: false, error: { code: "tool_failed", message: caught instanceof Error ? caught.message : "failed" } });
      }
      send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output } });
    },
    [send],
  );

  const onServerEvent = useCallback(
    (event: ServerEvent) => {
      switch (event.type) {
        case "input_audio_buffer.speech_started": {
          speechStartedAtRef.current = performance.now();
          if (replyRef.current && speakingRef.current) replyRef.current.interrupted = true;
          if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
          if (phaseRef.current !== "paused") setPhase("hearing");
          break;
        }
        case "input_audio_buffer.speech_stopped":
          if (phaseRef.current === "hearing") setPhase("thinking");
          break;
        case "conversation.item.input_audio_transcription.completed": {
          const text = String(event.transcript ?? "").trim();
          if (!text) break;
          const saving = postJson<{ message: ChatMessage | null }>("/api/widget/voice/realtime/transcript", { role: "user", text })
            .then((saved) => saved.message && callbacksRef.current.onUserMessage(saved.message))
            .catch(() => undefined);
          pendingUserRef.current = saving;
          break;
        }
        case "response.created": {
          if (!replyRef.current) {
            const id = `voice-${Date.now()}`;
            replyRef.current = { id, text: "", interrupted: false };
            callbacksRef.current.onReplyStart(id);
          }
          if (phaseRef.current !== "paused" && !speakingRef.current) setPhase("thinking");
          break;
        }
        case "response.output_audio_transcript.delta": {
          const delta = String(event.delta ?? "");
          if (replyRef.current && delta) {
            replyRef.current.text += delta;
            callbacksRef.current.onReplyDelta(replyRef.current.id, delta);
          }
          break;
        }
        case "output_audio_buffer.started":
          speakingRef.current = true;
          if (phaseRef.current !== "paused") setPhase("speaking");
          break;
        case "output_audio_buffer.stopped":
        case "output_audio_buffer.cleared":
          speakingRef.current = false;
          toListening();
          break;
        case "response.done": {
          const response = (event.response ?? {}) as { status?: string; output?: Array<{ type: string } & Partial<FunctionCallItem>> };
          const calls = (response.output ?? []).filter((item): item is FunctionCallItem => item.type === "function_call");
          if (response.status === "cancelled" && replyRef.current) replyRef.current.interrupted = true;
          if (calls.length > 0) {
            // Run the tools, hand back their results, and let the model continue the same reply.
            const running = calls.map((call) => {
              const promise = runTool(call).finally(() => toolsRunningRef.current.delete(call.call_id));
              toolsRunningRef.current.set(call.call_id, promise);
              return promise;
            });
            void Promise.all(running).then(() => send({ type: "response.create" }));
          } else {
            void finishReply();
            if (!speakingRef.current) toListening();
          }
          break;
        }
        case "error": {
          const message = (event.error as { message?: string } | undefined)?.message ?? "";
          // A cancel with nothing to cancel is harmless; anything else is worth logging.
          if (!/no active response|cancel/i.test(message)) console.warn("realtime error:", message);
          break;
        }
        default:
          break;
      }
    },
    [finishReply, runTool, send, setPhase, toListening],
  );

  // --- start / stop --------------------------------------------------------------------------

  const teardown = useCallback(() => {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    if (sessionTimerRef.current) window.clearTimeout(sessionTimerRef.current);
    if (dropTimerRef.current) window.clearTimeout(dropTimerRef.current);
    idleTimerRef.current = null;
    sessionTimerRef.current = null;
    dropTimerRef.current = null;
    if (meterRef.current) {
      cancelAnimationFrame(meterRef.current.frame);
      void meterRef.current.context.close().catch(() => undefined);
      meterRef.current = null;
    }
    channelRef.current?.close();
    channelRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    micRef.current?.getTracks().forEach((track) => track.stop());
    micRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    speakingRef.current = false;
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    endAfterSpeechRef.current = false;
    if (replyRef.current) {
      replyRef.current.interrupted = replyRef.current.interrupted || speakingRef.current;
      void finishReply();
    }
    teardown();
    setPhase("off");
  }, [finishReply, setPhase, teardown]);
  stopRef.current = stop;

  /** Call synchronously inside the click that starts voice, before any await (autoplay rules). */
  // A call token fetched before the customer taps (hover, welcome bubble), so tapping goes straight
  // to the microphone and the WebRTC handshake. Tokens cost nothing until a call is made with them.
  const grantRef = useRef<HeldGrant | null>(null);
  const grantLoadRef = useRef<Promise<HeldGrant> | null>(null);
  const fetchGrant = useCallback((): Promise<HeldGrant> => {
    grantLoadRef.current ??= postJson<Grant>("/api/widget/voice/realtime/session", {})
      .then((grant) => {
        const held = { ...grant, receivedAt: Date.now() };
        grantRef.current = held;
        return held;
      })
      .finally(() => {
        grantLoadRef.current = null;
      });
    return grantLoadRef.current;
  }, []);
  const freshGrant = () => {
    const grant = grantRef.current;
    return grant && Date.now() - grant.receivedAt < GRANT_USABLE_MS ? grant : null;
  };

  /** Gets a call ready ahead of a tap. Safe to call often. */
  const warmUp = useCallback(() => {
    preconnectToOpenAi();
    if (phaseRef.current !== "off" || freshGrant() || grantLoadRef.current) return;
    // A failed warm-up is retried (with its real error shown) when the customer taps.
    fetchGrant().catch(() => undefined);
  }, [fetchGrant]);

  const prime = useCallback(() => {
    const audio = audioRef.current ?? new Audio();
    audio.autoplay = true;
    audioRef.current = audio;
    void audio.play().catch(() => undefined);
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let last = 0;
      const tick = (now: number) => {
        if (now - last > 80) {
          last = now;
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += sample * sample;
          setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 10));
        }
        if (meterRef.current) meterRef.current.frame = requestAnimationFrame(tick);
      };
      meterRef.current = { context, frame: requestAnimationFrame(tick) };
    } catch {
      // No level meter; the call still works.
    }
  }, []);

  const start = useCallback(
    async (options: StartOptions) => {
      if (phaseRef.current !== "off") return true;
      setError(null);
      setLangState(options.lang);
      endAfterSpeechRef.current = false;
      setPhase("starting");
      if (!audioRef.current) prime();

      try {
        // Token (usually fetched already by warmUp) and microphone at the same time.
        preconnectToOpenAi();
        const ready = freshGrant();
        grantRef.current = null; // One call per token.
        const [grantResult, micResult] = await Promise.allSettled([
          ready
            ? Promise.resolve(ready)
            : (grantLoadRef.current ?? fetchGrant()).then((grant) => {
                grantRef.current = null;
                return grant;
              }),
          navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
        ]);
        // Keep the mic (so teardown releases it) even when the token failed.
        if (micResult.status === "fulfilled") micRef.current = micResult.value;
        if (micResult.status === "rejected") throw micResult.reason;
        if (grantResult.status === "rejected") throw grantResult.reason;
        let grant = grantResult.value;
        const mic = micResult.value;

        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        pc.ontrack = (event) => {
          if (audioRef.current) {
            audioRef.current.srcObject = event.streams[0] ?? null;
            void audioRef.current.play().catch(() => undefined);
          }
        };
        const dropped = () => {
          if (pcRef.current !== pc) return;
          setError("The voice call was disconnected. Tap Talk to start again.");
          stopRef.current();
        };
        pc.onconnectionstatechange = () => {
          const state = pc.connectionState;
          if (state === "connected") {
            if (dropTimerRef.current) window.clearTimeout(dropTimerRef.current);
            dropTimerRef.current = null;
          } else if (state === "failed") {
            dropped();
          } else if (state === "disconnected" && !dropTimerRef.current) {
            // Often a brief network blip (Wi-Fi/mobile hand-over) that recovers by itself.
            dropTimerRef.current = window.setTimeout(() => {
              dropTimerRef.current = null;
              if (pc.connectionState !== "connected") dropped();
            }, RECONNECT_GRACE_MS);
          }
        };
        for (const track of mic.getTracks()) pc.addTrack(track, mic);

        const channel = pc.createDataChannel("oai-events");
        channelRef.current = channel;
        channel.onmessage = (message) => {
          try {
            onServerEvent(JSON.parse(String(message.data)) as ServerEvent);
          } catch {
            // Ignore malformed events.
          }
        };
        // The voice service closed the call on its side.
        channel.addEventListener("close", () => {
          if (phaseRef.current !== "starting") dropped();
        });
        const opened = new Promise<void>((resolve, reject) => {
          channel.addEventListener("open", () => resolve(), { once: true });
          window.setTimeout(() => reject(new Error("The voice service didn't answer. Check your connection and try again.")), 15_000);
        });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const call = (secret: string) =>
          fetch(REALTIME_CALLS_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/sdp" },
            body: offer.sdp,
          });
        let answer = await call(grant.clientSecret);
        if (!answer.ok && answer.status < 500 && grant === ready) {
          // The pre-fetched token wasn't accepted any more (expired or used): get a new one.
          grant = await fetchGrant();
          grantRef.current = null;
          answer = await call(grant.clientSecret);
        }
        if (!answer.ok) {
          console.warn("realtime call refused:", answer.status, await answer.text().catch(() => ""));
          throw new Error("The voice service refused the call. Please try again in a moment.");
        }
        await pc.setRemoteDescription({ type: "answer", sdp: await answer.text() });
        await opened;

        startMeter(mic);
        sessionTimerRef.current = window.setTimeout(() => stopRef.current(), options.maxSessionMinutes * 60_000);
        setPhase("listening");
        resetIdleTimer();
        // The assistant speaks first: greet, and ask the name (or welcome back by name).
        send({ type: "response.create", response: { instructions: grant.opener, tool_choice: "none" } });
        return true;
      } catch (caught) {
        teardown();
        setPhase("off");
        setError(startErrorMessage(caught));
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- freshGrant only reads refs
    [fetchGrant, onServerEvent, prime, resetIdleTimer, send, setPhase, startMeter, teardown],
  );

  // --- controls ------------------------------------------------------------------------------

  const setMicEnabled = (enabled: boolean) => micRef.current?.getAudioTracks().forEach((track) => (track.enabled = enabled));

  /** Stops the assistant mid-reply so the customer can talk. */
  const interrupt = useCallback(() => {
    if (replyRef.current) replyRef.current.interrupted = true;
    send({ type: "response.cancel" });
    send({ type: "output_audio_buffer.clear" });
  }, [send]);

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

  /** Says something outside a customer turn (e.g. after the customer tapped Confirm). */
  const say = useCallback(
    (sentence: SpokenSentence) => {
      send({
        type: "response.create",
        response: { instructions: `Say this to the customer, naturally and briefly, in the same language: "${sentence.text}"` },
      });
    },
    [send],
  );

  /** Typed text during a call: added to the conversation as the customer's words and answered aloud. */
  const submitText = useCallback(
    async (text: string) => {
      const saving = postJson<{ message: ChatMessage | null }>("/api/widget/voice/realtime/transcript", { role: "user", text })
        .then((saved) => saved.message && callbacksRef.current.onUserMessage(saved.message))
        .catch(() => undefined);
      pendingUserRef.current = saving;
      speechStartedAtRef.current = performance.now();
      send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
      send({ type: "response.create" });
    },
    [send],
  );

  /** The model hears both languages; this only says which one to answer in. */
  const setLang = useCallback(
    (next: VoiceLang) => {
      setLangState(next);
      send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: next === "bn" ? "The customer prefers Bangla. Reply in Bangla from now on." : "The customer prefers English. Reply in English from now on." }],
        },
      });
    },
    [send],
  );

  /** Let the current reply finish, then end the call (e.g. after an order is placed). */
  const finishAfterSpeech = useCallback(() => {
    endAfterSpeechRef.current = true;
    window.setTimeout(() => {
      if (endAfterSpeechRef.current && !speakingRef.current && !replyRef.current) stopRef.current();
    }, 6000);
  }, []);

  useEffect(() => () => stopRef.current(), []);

  return {
    phase,
    level,
    liveText: "",
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
    clearError: () => setError(null),
  };
}
