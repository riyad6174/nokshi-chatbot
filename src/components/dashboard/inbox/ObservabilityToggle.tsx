"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { OBSERVABILITY_COOKIE } from "./observability-cookie";

/** "Show token usage" switch: remembered in this browser, applied by re-rendering the page. */
export function ObservabilityToggle({ on }: { on: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    document.cookie = `${OBSERVABILITY_COOKIE}=${on ? "0" : "1"}; path=/admin; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    startTransition(() => router.refresh());
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={toggle}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-60"
    >
      {/* Inline colors: the admin theme recolors the standard background utilities. */}
      <span
        aria-hidden
        className="relative inline-block h-3.5 w-6 rounded-full transition-colors"
        style={{ backgroundColor: on ? "#199e70" : "rgb(255 255 255 / 0.18)" }}
      >
        <span
          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all ${on ? "left-3" : "left-0.5"}`}
          style={{ backgroundColor: "#f7f5ef" }}
        />
      </span>
      {pending ? "Loading…" : "Show token usage"}
    </button>
  );
}
