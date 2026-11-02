"use client";

import type { VoiceLang, VoicePhase } from "@/components/chat/useVoiceSession";

const LABELS: Record<VoicePhase, string> = {
  off: "",
  starting: "Starting…",
  listening: "Listening",
  hearing: "Hearing you",
  thinking: "Thinking",
  speaking: "Speaking",
  paused: "Paused",
};

const BAR_SHAPE = [0.55, 0.9, 1, 0.75, 0.5];

/** What's happening right now: live bars while someone talks, a soft pulse while listening. */
function StatusIndicator({ phase, level }: { phase: VoicePhase; level: number }) {
  if (phase === "hearing" || phase === "speaking") {
    const color = phase === "hearing" ? "#10b981" : "#c026d3";
    // With a mic level (cloud speech) the bars follow the customer's voice; otherwise they animate.
    const live = phase === "hearing" && level > 0.02;
    return (
      <span className="flex h-4 w-[26px] items-center justify-center gap-[2px]" aria-hidden="true">
        {BAR_SHAPE.map((shape, index) => (
          <span
            key={index}
            className={live ? "w-[3px] rounded-full transition-[height] duration-75" : "voice-bar h-4"}
            style={
              live
                ? { backgroundColor: color, height: `${Math.max(3, Math.min(16, 4 + level * 26 * shape))}px` }
                : { backgroundColor: color, animationDelay: `${index * 110}ms` }
            }
          />
        ))}
      </span>
    );
  }
  if (phase === "thinking" || phase === "starting") {
    return (
      <span className="flex w-[26px] items-center justify-center gap-[3px]" aria-hidden="true">
        {[0, 160, 320].map((delay) => (
          <span key={delay} className="h-1.5 w-1.5 animate-typing-dot rounded-full bg-indigo-500" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </span>
    );
  }
  return (
    <span className="relative flex h-4 w-[26px] items-center justify-center" aria-hidden="true">
      {phase === "listening" ? <span className="absolute h-2.5 w-2.5 animate-pulse-ring rounded-full bg-emerald-400" /> : null}
      <span className={`relative h-2.5 w-2.5 rounded-full ${phase === "listening" ? "bg-emerald-500" : "bg-stone-400"}`} />
    </span>
  );
}

/**
 * Voice-mode controls, floating beside the assistant button: status, language and pause/end.
 * Deliberately minimal: the reply is heard, not read, and the conversation stays in the chat.
 */
export function VoiceControlCard({
  phase,
  level,
  lang,
  supportsBangla,
  position,
  onLang,
  onInterrupt,
  onPause,
  onResume,
  onStop,
}: {
  phase: VoicePhase;
  /** Microphone level 0..1 (cloud speech mode). */
  level: number;
  lang: VoiceLang;
  supportsBangla: boolean;
  position: "left" | "right";
  onLang: (lang: VoiceLang) => void;
  /** Stop the assistant mid-reply so the customer can talk. */
  onInterrupt: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Voice assistant controls"
      className={`fixed bottom-[1.6rem] z-[60] flex max-w-[calc(100vw-6.5rem)] animate-slide-in items-center gap-1.5 rounded-2xl border border-stone-200 bg-white/95 py-1.5 pl-3 pr-1.5 shadow-panel backdrop-blur ${
        position === "left" ? "left-[5.6rem]" : "right-[5.6rem]"
      }`}
    >
      <span className="flex min-w-[104px] items-center gap-1.5" aria-live="polite">
        <StatusIndicator phase={phase} level={level} />
        <span className="truncate text-[12px] font-semibold text-stone-800">{LABELS[phase]}</span>
      </span>

      {supportsBangla ? (
        <div className="flex overflow-hidden rounded-full bg-stone-100 p-0.5 text-[11px] font-semibold" role="group" aria-label="Voice language">
          {(["bn", "en"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onLang(option)}
              aria-pressed={lang === option}
              className={`rounded-full px-2 py-0.5 transition ${lang === option ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"}`}
            >
              {option === "bn" ? "বাং" : "EN"}
            </button>
          ))}
        </div>
      ) : null}

      {phase === "speaking" || phase === "thinking" ? (
        <button
          type="button"
          onClick={onInterrupt}
          className="flex h-8 items-center gap-1 rounded-full bg-stone-900 px-2.5 text-[11.5px] font-semibold text-white transition hover:bg-stone-700"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          Stop
        </button>
      ) : null}
      <button
        type="button"
        onClick={phase === "paused" ? onResume : onPause}
        aria-label={phase === "paused" ? "Resume" : "Pause"}
        title={phase === "paused" ? "Resume" : "Pause"}
        className="flex h-8 w-8 items-center justify-center rounded-full text-stone-600 transition hover:bg-stone-100 hover:text-stone-900"
      >
        {phase === "paused" ? (
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={onStop}
        aria-label="End voice"
        title="End voice"
        className="flex h-8 items-center gap-1 rounded-full bg-red-500 px-2.5 text-[11.5px] font-semibold text-white transition hover:bg-red-600"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
          <path d="M12 9c-3.6 0-6.9 1.3-9.3 3.5-.4.4-.4 1 0 1.4l2 2c.4.4 1 .4 1.4.1l2.3-1.7c.3-.2.4-.5.4-.8V11.6a12 12 0 0 1 6.4 0v1.9c0 .3.1.6.4.8l2.3 1.7c.4.3 1 .3 1.4-.1l2-2c.4-.4.4-1 0-1.4A13.3 13.3 0 0 0 12 9z" />
        </svg>
        End
      </button>
    </div>
  );
}
