"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/client/format";
import type { AttachmentData, CustomerDetailsData, OrderStatusData, RefineOptions } from "@/types/chat";

/** Tappable chips built from search facets ("Black", "Olive", "Trekline"...). */
export function RefineChips({
  options,
  accent,
  disabled,
  onSelect,
}: {
  options: RefineOptions;
  accent: string;
  disabled?: boolean;
  onSelect: (text: string) => void;
}) {
  const phrase = (name: string, value: string) => {
    const subject = options.query.trim();
    if (name === "category") return `Show me ${value}`;
    if (name === "brand") return subject ? `${subject} by ${value}` : `Show me ${value}`;
    return subject ? `${subject} in ${value}` : `Show me ${value} options`;
  };
  let delay = 0;
  return (
    <div className="space-y-1.5">
      {options.facets.map((facet) => (
        <div key={facet.name}>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-stone-400">{facet.name}</p>
          <div className="flex flex-wrap gap-1.5">
            {facet.values.map((value) => {
              delay += 40;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(phrase(facet.name, value))}
                  className="animate-pop rounded-full border bg-white px-2.5 py-1 text-[11.5px] font-medium text-stone-700 transition hover:-translate-y-px hover:shadow-sm active:scale-95 disabled:opacity-50"
                  style={{ borderColor: `${accent}55`, animationDelay: `${delay}ms` }}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const fieldClass =
  "w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[12.5px] text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none";

/** Collects delivery details in the chat, then hands off to checkout with them pre-filled. */
export function DetailsForm({
  prefill,
  accent,
  busy,
  onSubmit,
  onSkip,
}: {
  prefill: Partial<CustomerDetailsData>;
  accent: string;
  busy?: boolean;
  onSubmit: (details: CustomerDetailsData) => void;
  onSkip: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="animate-fade-up space-y-2 rounded-xl border border-stone-200 bg-white p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const details: CustomerDetailsData = {
          name: String(data.get("name") ?? "").trim(),
          phone: String(data.get("phone") ?? "").trim(),
          address: String(data.get("address") ?? "").trim(),
          city: String(data.get("city") ?? "").trim(),
          email: "",
          notes: "",
        };
        if (details.name.length < 2) return setError("Please enter your name.");
        if (details.phone.replace(/\D/g, "").length < 8) return setError("Please enter a valid phone number.");
        if (details.address.length < 5) return setError("Please enter your delivery address.");
        setError(null);
        onSubmit(details);
      }}
    >
      <p className="text-[12px] font-semibold text-stone-800">Delivery details</p>
      <input name="name" aria-label="Full name" placeholder="Full name" autoComplete="name" defaultValue={prefill.name ?? ""} className={fieldClass} />
      <input name="phone" aria-label="Phone" placeholder="Phone (e.g. 01712 345678)" type="tel" autoComplete="tel" defaultValue={prefill.phone ?? ""} className={fieldClass} />
      <textarea name="address" aria-label="Address" placeholder="House, road, area" rows={2} autoComplete="street-address" defaultValue={prefill.address ?? ""} className={`${fieldClass} resize-none`} />
      <input name="city" aria-label="City" placeholder="City (optional)" autoComplete="address-level2" defaultValue={prefill.city ?? ""} className={fieldClass} />
      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg px-3 py-2 text-[12.5px] font-semibold text-white transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
        style={{ backgroundColor: accent }}
      >
        {busy ? "Preparing checkout…" : "Continue to checkout"}
      </button>
      <button type="button" onClick={onSkip} disabled={busy} className="block w-full text-center text-[11px] text-stone-500 underline-offset-2 hover:underline">
        Skip, I&apos;ll fill this in at checkout
      </button>
      <p className="text-center text-[10px] text-stone-400">You&apos;ll choose payment and place the order on the next page.</p>
    </form>
  );
}

const STEPS = ["placed", "confirmed", "processing", "shipped", "delivered"];

export function OrderStatusCard({ order, accent }: { order: OrderStatusData; accent: string }) {
  const stopped = order.status === "cancelled" || order.status === "refunded";
  const reached = STEPS.indexOf(order.status);
  return (
    <div className="animate-fade-up rounded-xl border border-stone-200 bg-white p-3 text-[12px]">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[12.5px] font-semibold text-stone-900">{order.orderNumber}</p>
        <span
          className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${stopped ? "bg-stone-100 text-stone-600" : "text-white"}`}
          style={stopped ? undefined : { backgroundColor: accent }}
        >
          {order.statusLabel}
        </span>
      </div>
      {!stopped ? (
        <div className="mt-2.5 flex items-center gap-1" aria-label={`Progress: ${order.statusLabel}`}>
          {STEPS.map((step, index) => (
            <div key={step} className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: index <= reached ? "100%" : "0%", backgroundColor: accent, transitionDelay: `${index * 120}ms` }}
              />
            </div>
          ))}
        </div>
      ) : null}
      <ul className="mt-2 space-y-0.5 text-stone-600">
        {order.items.map((item, index) => (
          <li key={index} className="flex justify-between gap-2">
            <span className="truncate">
              {item.quantity} × {item.name}
              {item.variantTitle ? ` (${item.variantTitle})` : ""}
            </span>
            <span className="shrink-0">{formatMoney(item.lineTotalMinor, order.currency)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex justify-between border-t border-stone-100 pt-1.5 font-semibold text-stone-900">
        <span>Total {order.paymentMethod === "cod" ? "(cash on delivery)" : ""}</span>
        <span>{formatMoney(order.totalMinor, order.currency)}</span>
      </div>
      {order.trackingNumber ? <p className="mt-1 text-[11px] text-stone-500">Tracking: {order.trackingNumber}</p> : null}
      {order.history.length > 0 && order.history[order.history.length - 1]!.note ? (
        <p className="mt-1 text-[11px] text-stone-500">“{order.history[order.history.length - 1]!.note}”</p>
      ) : null}
    </div>
  );
}

export function AttachmentView({ attachment, onDark }: { attachment: AttachmentData; onDark?: boolean }) {
  if (attachment.kind === "image") {
    return (
      <a href={attachment.url} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={attachment.url} alt={attachment.name} className="max-h-48 rounded-xl object-cover" loading="lazy" />
      </a>
    );
  }
  if (attachment.kind === "audio") {
    return (
      <div className="space-y-1">
        <audio controls src={attachment.url} className="h-9 w-56 max-w-full" preload="metadata" />
        {attachment.transcript ? (
          <p className={`text-[11.5px] italic ${onDark ? "text-white/85" : "text-stone-600"}`}>“{attachment.transcript}”</p>
        ) : null}
      </div>
    );
  }
  return (
    <a
      href={attachment.url}
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] underline-offset-2 hover:underline ${onDark ? "bg-white/15" : "bg-stone-100"}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
      <span className="truncate">{attachment.name}</span>
    </a>
  );
}
