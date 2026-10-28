"use client";

import { useState } from "react";

export function CopyBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <p className="text-[10.5px] font-medium text-stone-500">{label}</p>
        <button
          type="button"
          onClick={copy}
          className="rounded-md border border-stone-200 px-2 py-0.5 text-[10.5px] font-medium text-stone-600 transition hover:bg-stone-50"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="mt-1 overflow-x-auto rounded-lg bg-stone-950 px-3 py-2.5 text-[11px] leading-relaxed text-stone-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}
