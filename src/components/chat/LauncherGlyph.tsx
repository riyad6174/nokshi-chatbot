"use client";

import type { OrbState } from "@/components/chat/AssistantOrb";

const BAR_SHAPE = [0.55, 0.9, 1, 0.75, 0.5];

function MicIcon({ muted, pulsing }: { muted?: boolean; pulsing?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${pulsing ? "animate-pulse" : "opacity-90"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      {muted ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

/**
 * What's drawn over the launcher orb. During a call it shows, even with the panel closed, that the
 * assistant is still there: rings while listening, bars while someone talks, a spinner while thinking.
 */
export function LauncherGlyph({ state, level, inCall }: { state: OrbState; level: number; inCall: boolean }) {
  const hearing = state === "hearing";
  const followVoice = hearing && level > 0.02;
  return (
    <>
      {inCall && (state === "listening" || hearing) ? (
        <>
          <span className={`launcher-ring ${hearing ? "launcher-ring-fast" : ""}`} aria-hidden="true" />
          <span
            className={`launcher-ring ${hearing ? "launcher-ring-fast" : ""}`}
            style={{ animationDelay: hearing ? "0.55s" : "1.1s" }}
            aria-hidden="true"
          />
        </>
      ) : null}
      {inCall && state === "thinking" ? <span className="launcher-spinner" aria-hidden="true" /> : null}

      <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-[3px] text-white drop-shadow">
        {state === "speaking" || hearing ? (
          BAR_SHAPE.map((shape, bar) => (
            <span
              key={bar}
              className={followVoice ? "w-[3px] rounded-full bg-white transition-[height] duration-75" : "voice-bar h-5"}
              style={followVoice ? { height: `${Math.max(4, Math.min(22, 5 + level * 34 * shape))}px` } : { animationDelay: `${bar * 110}ms` }}
              aria-hidden="true"
            />
          ))
        ) : inCall && state === "thinking" ? (
          [0, 160, 320].map((delay) => (
            <span key={delay} className="h-1.5 w-1.5 animate-typing-dot rounded-full bg-white" style={{ animationDelay: `${delay}ms` }} aria-hidden="true" />
          ))
        ) : (
          <MicIcon muted={state === "paused"} pulsing={inCall && state === "listening"} />
        )}
      </span>
    </>
  );
}
