"use client";

import { useEffect, useRef, useState } from "react";
import { AssistantOrb } from "@/components/chat/AssistantOrb";
import { playChime } from "@/lib/client/chime";

// Greets a visitor shortly after they land: a bubble next to the assistant orb, a short chime, then
// the spoken welcome. Browsers block sound until the visitor interacts with the page, so if that's
// refused the chime and welcome play on their first click, tap or key press instead. The microphone
// is never turned on here; only "Talk to me" starts the voice assistant.

// Shown on every page load (refreshes and return visits too), so a returning shopper is always
// reminded. Closing it with × hides it for the rest of this browser session. The chime and the
// spoken greeting play once per session for the same text, so refreshing doesn't make it talk again.
const SHOW_AFTER_MS = 1500;
const DISMISSED_KEY = "nokshi:welcome-dismissed";
const SPOKEN_KEY = "nokshi:welcome-spoken";

type Greeting = {
  enabled: boolean;
  text?: string;
  lang?: "en" | "bn";
  audio?: string | null;
  mime?: string | null;
  assistantName?: string;
  /** Set for a returning visitor with something to pick up: a cart, an order, a product they asked about. */
  reminder?: { kind: string; product: { name: string; imageUrl: string | null } | null } | null;
};

function storageGet(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function storageSet(storage: () => Storage, key: string, value: string) {
  try {
    storage().setItem(key, value);
  } catch {
    // Private mode / blocked storage: the bubble may show again, which is fine.
  }
}

export function WelcomeBubble({
  widgetKey,
  suppressed,
  accent,
  position,
  onVisibleChange,
  onSpeakingChange,
  onTalk,
  onChat,
}: {
  widgetKey: string;
  /** The chat is open (or voice is on): don't greet. */
  suppressed: boolean;
  accent: string;
  position: "left" | "right";
  onVisibleChange?: (visible: boolean) => void;
  /** Lets the launcher orb animate while the welcome is spoken. */
  onSpeakingChange?: (speaking: boolean) => void;
  onTalk: () => void;
  onChat: () => void;
}) {
  const [greeting, setGreeting] = useState<Greeting | null>(null);
  const [visible, setVisible] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const spokenRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const suppressedRef = useRef(suppressed);
  suppressedRef.current = suppressed;

  useEffect(() => onVisibleChange?.(visible), [visible, onVisibleChange]);
  useEffect(() => onSpeakingChange?.(speaking), [speaking, onSpeakingChange]);

  useEffect(() => {
    if (storageGet(() => window.sessionStorage, DISMISSED_KEY)) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (suppressedRef.current) return;
      // Bangla first; the server switches to English for stores without Bangla.
      const lang = "bn";
      try {
        const params = new URLSearchParams({ widgetKey, lang, kind: "welcome" });
        const response = await fetch(`/api/widget/voice/greeting?${params}`);
        const body = (await response.json().catch(() => null)) as Greeting | null;
        if (cancelled || !response.ok || !body?.enabled || suppressedRef.current) return;
        // Already said this in this session (e.g. a refresh): show it, but quietly.
        spokenRef.current = storageGet(() => window.sessionStorage, SPOKEN_KEY) === body.text;
        setGreeting(body);
        setVisible(true);
      } catch {
        // No greeting; the assistant button still works.
      }
    }, SHOW_AFTER_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [widgetKey]);

  // Chime, then the spoken welcome: right away if the browser allows sound, else on first interaction.
  useEffect(() => {
    if (!visible || !greeting?.text) return;
    let removed = false;

    const speakWelcome = () => {
      if (suppressedRef.current) return;
      const finish = () => setSpeaking(false);
      if (greeting.audio) {
        const audio = new Audio(`data:${greeting.mime || "audio/mpeg"};base64,${greeting.audio}`);
        audioRef.current = audio;
        audio.onended = finish;
        setSpeaking(true);
        audio.play().catch(finish);
      } else if ("speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(greeting.text);
        utterance.lang = greeting.lang === "bn" ? "bn-BD" : "en-US";
        utterance.onend = finish;
        utterance.onerror = finish;
        setSpeaking(true);
        window.speechSynthesis.speak(utterance);
      }
    };

    const attempt = async () => {
      if (spokenRef.current || suppressedRef.current) return true;
      const allowed = await playChime();
      if (!allowed) return false;
      spokenRef.current = true;
      storageSet(() => window.sessionStorage, SPOKEN_KEY, greeting.text ?? "");
      window.setTimeout(speakWelcome, 550);
      return true;
    };

    const onInteract = (event: Event) => {
      // Clicking the bubble's own buttons starts voice or chat instead; don't talk over that.
      if (bubbleRef.current && event.target instanceof Node && bubbleRef.current.contains(event.target)) {
        cleanup();
        return;
      }
      cleanup();
      void attempt();
    };
    const cleanup = () => {
      if (removed) return;
      removed = true;
      window.removeEventListener("pointerdown", onInteract, true);
      window.removeEventListener("keydown", onInteract, true);
    };

    void attempt().then((played) => {
      if (played || removed) return;
      window.addEventListener("pointerdown", onInteract, true);
      window.addEventListener("keydown", onInteract, true);
    });
    return cleanup;
  }, [visible, greeting]);

  const stopSpeaking = () => {
    audioRef.current?.pause();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    spokenRef.current = true;
    setSpeaking(false);
  };

  useEffect(() => {
    if (suppressed && visible) {
      stopSpeaking();
      setVisible(false);
    }
  }, [suppressed, visible]);

  if (!visible || !greeting?.text) return null;
  const reminder = greeting.reminder ?? null;

  const dismiss = () => {
    stopSpeaking();
    storageSet(() => window.sessionStorage, DISMISSED_KEY, "1");
    setVisible(false);
  };

  return (
    <div
      ref={bubbleRef}
      role="dialog"
      aria-label="AI shopping assistant"
      className={`ai-border fixed bottom-[6.5rem] z-40 w-[min(330px,calc(100vw-2rem))] animate-bubble-drop rounded-2xl p-4 shadow-panel ${
        position === "left" ? "left-5 origin-bottom-left" : "right-5 origin-bottom-right"
      }`}
    >
      {/* Tail pointing at the assistant orb. */}
      <span
        className={`absolute -bottom-[7px] h-3.5 w-3.5 rotate-45 border-b border-r border-indigo-300 bg-white ${
          position === "left" ? "left-7" : "right-7"
        }`}
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded-md p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>

      <div className="flex items-start gap-3 pr-4">
        <AssistantOrb size={44} state={speaking ? "speaking" : "idle"} accent={accent} />
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em]">
            <span className="ai-gradient-text">{reminder ? "Welcome back" : "AI voice assistant"}</span>
          </p>
          <p className="mt-1 text-[13px] leading-snug text-stone-800">{greeting.text}</p>
        </div>
      </div>

      {reminder?.product ? (
        <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-stone-50 p-2">
          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-stone-200">
            {reminder.product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={reminder.product.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-sm font-semibold text-stone-400">
                {reminder.product.name.charAt(0)}
              </span>
            )}
          </div>
          <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-stone-800">{reminder.product.name}</p>
        </div>
      ) : null}

      <div className="mt-3.5 flex gap-2">
        <button
          type="button"
          onClick={() => {
            stopSpeaking();
            setVisible(false);
            onTalk();
          }}
          className="flex flex-[1.3] items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 via-fuchsia-600 to-cyan-600 py-2.5 text-[12.5px] font-semibold text-white shadow-md transition hover:brightness-110 active:scale-[0.98]"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
          Talk to me
        </button>
        <button
          type="button"
          onClick={() => {
            stopSpeaking();
            setVisible(false);
            onChat();
          }}
          className="flex-1 rounded-xl border border-stone-200 bg-white py-2.5 text-[12.5px] font-medium text-stone-700 transition hover:bg-stone-50"
        >
          {reminder ? "Continue chat" : "Type instead"}
        </button>
      </div>
      <p className="mt-2 text-[10.5px] leading-snug text-stone-400">
        The microphone only turns on when you tap Talk. Conversations are saved to help with your order.
      </p>
    </div>
  );
}
