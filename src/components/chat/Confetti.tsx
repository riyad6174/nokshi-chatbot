"use client";

import { useMemo, type CSSProperties } from "react";

const COLORS = ["#6366f1", "#ec4899", "#06b6d4", "#f59e0b", "#10b981", "#a855f7"];

/** A one-off burst of confetti over the chat (remount with a new key to play again). */
export function Confetti({ pieces = 70 }: { pieces?: number }) {
  const items = useMemo(
    () =>
      Array.from({ length: pieces }, (_, index) => ({
        left: Math.random() * 100,
        color: COLORS[index % COLORS.length]!,
        delay: Math.random() * 0.6,
        fall: 2.2 + Math.random() * 1.4,
        drift: (Math.random() - 0.5) * 160,
        spin: 360 + Math.random() * 540,
        round: Math.random() > 0.6,
      })),
    [pieces],
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden="true">
      {items.map((item, index) => (
        <span
          key={index}
          className="confetti-piece"
          style={
            {
              left: `${item.left}%`,
              backgroundColor: item.color,
              borderRadius: item.round ? "9999px" : undefined,
              "--delay": `${item.delay}s`,
              "--fall": `${item.fall}s`,
              "--drift": `${item.drift}px`,
              "--spin": `${item.spin}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
