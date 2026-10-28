"use client";

import { formatMoney } from "@/lib/client/format";

type CheckoutButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  accent?: string;
  subtotalMinor?: number;
  currency?: string;
  showCaption?: boolean;
};

export function CheckoutButton({
  onClick,
  disabled,
  busy,
  accent = "#0f766e",
  subtotalMinor,
  currency,
  showCaption = true,
}: CheckoutButtonProps) {
  return (
    <div className="w-full">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ backgroundColor: accent }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        {busy
          ? "Preparing checkout..."
          : subtotalMinor !== undefined && currency
            ? `Review & checkout · ${formatMoney(subtotalMinor, currency)}`
            : "Review & checkout"}
      </button>
      {showCaption ? (
        <p className="mt-1.5 text-center text-[11px] leading-snug text-stone-500">
          You&apos;ll finish payment on the store&apos;s secure checkout page. Nothing is charged in chat.
        </p>
      ) : null}
    </div>
  );
}
