"use client";

import type { ReactNode } from "react";

type AskAssistantButtonProps = {
  prompt?: string;
  className?: string;
  children: ReactNode;
};

export function AskAssistantButton({ prompt, className, children }: AskAssistantButtonProps) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        window.dispatchEvent(new CustomEvent("nokshi:open-chat", { detail: { prompt } }));
      }}
    >
      {children}
    </button>
  );
}
