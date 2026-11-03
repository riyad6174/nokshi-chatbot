"use client";

import type { ReactNode } from "react";
import { AssistantOrb, type OrbState } from "@/components/chat/AssistantOrb";
import type { VoiceLang, VoicePhase } from "@/components/chat/useVoiceSession";

// The voice-first assistant: a dark panel with the assistant's orb, what it's saying right now, and
// call controls. Only the assistant's words are shown (the customer knows what they said). Product,
// cart and order cards appear in the middle of the screen (CardStage); a pill here brings them back.

const STATUS: Record<VoicePhase, string> = {
  off: "Tap to talk",
  starting: "Connecting…",
  listening: "Listening",
  hearing: "Hearing you",
  thinking: "Thinking",
  speaking: "Speaking",
  paused: "Muted",
};

function StatusLine({ phase }: { phase: VoicePhase }) {
  const color =
    phase === "hearing" ? "bg-emerald-400" : phase === "speaking" ? "bg-fuchsia-400" : phase === "thinking" ? "bg-indigo-300" : "bg-white/50";
  return (
    <p
      key={phase}
      className="caption-in flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75"
      aria-live="polite"
    >
      {phase === "thinking" || phase === "starting" ? (
        <span className="flex gap-1" aria-hidden="true">
          {[0, 160, 320].map((delay) => (
            <span key={delay} className="h-1.5 w-1.5 animate-typing-dot rounded-full bg-white/80" style={{ animationDelay: `${delay}ms` }} />
          ))}
        </span>
      ) : phase === "hearing" || phase === "speaking" ? (
        <span className="flex h-3 items-center gap-[2px]" aria-hidden="true">
          {[0, 1, 2, 3].map((bar) => (
            <span key={bar} className={`voice-bar h-3 ${color}`} style={{ animationDelay: `${bar * 110}ms`, width: 2.5 }} />
          ))}
        </span>
      ) : (
        <span className={`h-1.5 w-1.5 rounded-full ${color} ${phase === "listening" ? "animate-pulse" : ""}`} aria-hidden="true" />
      )}
      {STATUS[phase]}
    </p>
  );
}

function RoundButton({
  label,
  onClick,
  tone = "glass",
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: "glass" | "danger" | "active";
  children: ReactNode;
}) {
  const tones = {
    glass: "bg-white/10 text-white hover:bg-white/20 ring-1 ring-white/15",
    active: "bg-white text-stone-900 hover:bg-white/90",
    danger: "bg-rose-500 text-white hover:bg-rose-400",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 items-center justify-center rounded-full transition duration-200 active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

export function VoiceDock({
  assistantName,
  accent,
  phase,
  level,
  active,
  caption,
  captionKey,
  lang,
  supportsBangla,
  voiceAvailable,
  error,
  celebration,
  cardsHidden,
  onShowCards,
  onStart,
  onStop,
  onPause,
  onResume,
  onInterrupt,
  onLang,
  onOpenChat,
  onClose,
}: {
  assistantName: string;
  accent: string;
  phase: VoicePhase;
  level: number;
  active: boolean;
  /** What the assistant is saying (or last said). */
  caption: string;
  /** Changes when a new reply starts, to replay the caption entrance. */
  captionKey: string;
  lang: VoiceLang;
  supportsBangla: boolean;
  voiceAvailable: boolean;
  error: string | null;
  /** Order just placed: plays the confetti. */
  celebration: ReactNode;
  /** Cards exist but are hidden: what the pill that shows them again says ("products", "your order"). */
  cardsHidden: string | null;
  onShowCards: () => void;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onInterrupt: () => void;
  onLang: (lang: VoiceLang) => void;
  onOpenChat: () => void;
  onClose: () => void;
}) {
  const shownPhase: VoicePhase = active ? phase : "off";
  const orbState: OrbState = shownPhase === "off" ? "idle" : shownPhase === "starting" ? "thinking" : shownPhase;

  const onOrb = () => {
    if (!active) onStart();
    else if (phase === "paused") onResume();
    else if (phase === "speaking" || phase === "thinking") onInterrupt();
  };

  return (
    <section
      role="dialog"
      aria-label={`${assistantName}, voice assistant`}
      data-phase={shownPhase}
      className="voice-dock fixed inset-x-3 bottom-[5.75rem] z-50 overflow-hidden rounded-[28px] bg-[#0b0a1d] text-white ring-1 ring-white/10 animate-panel-in sm:inset-x-auto sm:right-6 sm:w-[380px]"
    >
      <div className="voice-aurora" aria-hidden="true" />
      {celebration}

      <div className="relative flex items-center gap-2 px-4 pt-3.5">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          {active ? <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-emerald-400" /> : null}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${active ? "bg-emerald-400" : "bg-white/40"}`} />
        </span>
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-white/90">
          {assistantName}
          <span className="ml-1.5 font-normal text-white/50">{active ? "· live" : "· AI voice assistant"}</span>
        </p>
        <button
          type="button"
          onClick={onOpenChat}
          aria-label="Open text chat"
          title="Type instead"
          className="rounded-full p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="6" width="18" height="12" rx="2.5" />
            <path d="M7 10h.01M11 10h.01M15 10h.01M7.5 14h9" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close assistant"
          className="rounded-full p-1.5 text-white/60 transition hover:rotate-90 hover:bg-white/10 hover:text-white"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="relative flex flex-col items-center px-5 pb-5 pt-2">
        <button
          type="button"
          onClick={onOrb}
          disabled={!voiceAvailable && !active}
          aria-label={!active ? "Start talking" : phase === "paused" ? "Unmute" : phase === "speaking" ? "Interrupt" : "Voice assistant"}
          className="relative rounded-full transition duration-300 hover:scale-[1.03] active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {shownPhase === "listening" ? (
            <>
              <span className="listen-ring" aria-hidden="true" />
              <span className="listen-ring" aria-hidden="true" />
            </>
          ) : null}
          <AssistantOrb size={116} state={orbState} level={level} accent={accent} />
          {!active ? (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-white drop-shadow-lg">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </span>
          ) : phase === "paused" ? (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-white">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16" />
              </svg>
            </span>
          ) : null}
        </button>

        <div className="mt-3">
          <StatusLine phase={shownPhase} />
        </div>

        {/* Newest words at the bottom; older ones fade out at the top. */}
        <div className="voice-caption mt-2 flex h-[4.4rem] w-full items-end justify-center overflow-hidden text-center">
          {caption ? (
            <p key={captionKey} className="caption-in text-[15px] font-medium leading-snug text-white">
              {caption}
            </p>
          ) : (
            <p className="text-[13px] leading-snug text-white/55">
              {active ? "Go ahead, I'm listening…" : "Talk in Bangla or English. I'll find products and place your order."}
            </p>
          )}
        </div>

        {cardsHidden ? (
          <button
            type="button"
            onClick={onShowCards}
            className="caption-in mt-2 flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/20"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            Show {cardsHidden}
          </button>
        ) : null}

        {error ? (
          <p className="caption-in mt-2 w-full rounded-xl bg-rose-500/15 px-3 py-1.5 text-center text-[11.5px] text-rose-100 ring-1 ring-rose-400/30">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex w-full items-center justify-center gap-3">
          {active ? (
            <>
              {supportsBangla ? (
                <div className="flex rounded-full bg-white/10 p-1 text-[11.5px] font-semibold ring-1 ring-white/15" role="group" aria-label="Voice language">
                  {(["bn", "en"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => onLang(option)}
                      aria-pressed={lang === option}
                      className={`rounded-full px-2.5 py-1.5 transition ${lang === option ? "bg-white text-stone-900" : "text-white/70 hover:text-white"}`}
                    >
                      {option === "bn" ? "বাং" : "EN"}
                    </button>
                  ))}
                </div>
              ) : null}
              {phase === "speaking" || phase === "thinking" ? (
                <RoundButton label="Stop talking" onClick={onInterrupt}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2.5" />
                  </svg>
                </RoundButton>
              ) : null}
              <RoundButton
                label={phase === "paused" ? "Unmute" : "Mute"}
                onClick={phase === "paused" ? onResume : onPause}
                tone={phase === "paused" ? "active" : "glass"}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  {phase === "paused" ? <path d="M4 4l16 16" /> : null}
                </svg>
              </RoundButton>
              <RoundButton label="End call" onClick={onStop} tone="danger">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                  <path d="M12 9c-3.6 0-6.9 1.3-9.3 3.5-.4.4-.4 1 0 1.4l2 2c.4.4 1 .4 1.4.1l2.3-1.7c.3-.2.4-.5.4-.8V11.6a12 12 0 0 1 6.4 0v1.9c0 .3.1.6.4.8l2.3 1.7c.4.3 1 .3 1.4-.1l2-2c.4-.4.4-1 0-1.4A13.3 13.3 0 0 0 12 9z" />
                </svg>
              </RoundButton>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onStart}
                disabled={!voiceAvailable}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-white py-3 text-[13.5px] font-semibold text-stone-900 transition hover:bg-white/90 active:scale-[0.98] disabled:opacity-50"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
                {voiceAvailable ? "Start talking" : "Voice not supported here"}
              </button>
              <button
                type="button"
                onClick={onOpenChat}
                className="rounded-full px-4 py-3 text-[13px] font-medium text-white/80 ring-1 ring-white/20 transition hover:bg-white/10 hover:text-white"
              >
                Type
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
