"use client";

import type { CSSProperties } from "react";

/** still: no motion at all (inside the open chat, so only the header orb moves while talking). */
export type OrbState = "still" | "idle" | "listening" | "hearing" | "thinking" | "speaking" | "paused";

/**
 * The assistant's face: blurred colour blobs that swirl like Siri / Gemini. It breathes when idle,
 * swirls faster while thinking, pulses with rings while speaking and swells with the customer's
 * voice level while they talk. Styles live in globals.css (.orb*).
 */
export function AssistantOrb({
  size,
  state = "idle",
  level = 0,
  accent = "#0f766e",
  className = "",
}: {
  size: number;
  state?: OrbState;
  /** Microphone level 0..1, used while the customer is talking. */
  level?: number;
  accent?: string;
  className?: string;
}) {
  const scale = state === "hearing" ? 1 + Math.min(level, 1) * 0.25 : 1;
  const style = {
    width: size,
    height: size,
    "--orb-a": accent,
    "--orb-b": "#a855f7",
    "--orb-c": "#22d3ee",
    "--orb-d": "#f472b6",
    "--orb-glow": `${accent}aa`,
    "--orb-blur": `${Math.max(4, Math.round(size / 9))}px`,
  } as CSSProperties;

  return (
    <span className={`orb-wrap inline-block shrink-0 ${className}`} data-state={state} style={style} aria-hidden="true">
      <span className="orb-halo" />
      <span className="orb-ring" />
      <span className="orb-ring" />
      <span className="orb block h-full w-full" style={{ transform: `scale(${scale})` }}>
        <span className="orb-blob" />
        <span className="orb-blob" />
        <span className="orb-blob" />
        <span className="orb-shine" />
      </span>
    </span>
  );
}
