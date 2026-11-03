"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/client/format";
import type { AttachmentData, CustomerDetailsData, OrderConfirmationData, OrderStatusData, RefineOptions } from "@/types/chat";

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

type DetailDraft = { name: string; phone: string; address: string; city: string };

/** One message with the exact details, so the assistant never has to re-hear them. */
function detailsMessage(intro: string, draft: DetailDraft, area?: string): string {
  return [
    `${intro}:`,
    `Name: ${draft.name.trim()}`,
    `Phone: ${draft.phone.trim()}`,
    `Address: ${draft.address.trim()}`,
    draft.city.trim() ? `City: ${draft.city.trim()}` : "",
    area ? `Delivery area: ${area}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function DetailFields({ value, onChange }: { value: DetailDraft; onChange: (next: DetailDraft) => void }) {
  const set = (key: keyof DetailDraft) => (event: { target: { value: string } }) => onChange({ ...value, [key]: event.target.value });
  return (
    <>
      <input aria-label="Full name" placeholder="Full name" value={value.name} onChange={set("name")} required minLength={2} className={fieldClass} />
      <input
        aria-label="Phone number"
        placeholder="Phone, e.g. 01712345678"
        value={value.phone}
        onChange={set("phone")}
        required
        type="tel"
        inputMode="tel"
        pattern="[+0-9০-৯\s\-]{8,20}"
        className={`${fieldClass} font-mono tracking-wide`}
      />
      <input aria-label="Delivery address" placeholder="House, road, area" value={value.address} onChange={set("address")} required minLength={5} className={fieldClass} />
      <input aria-label="City" placeholder="City" value={value.city} onChange={set("city")} className={fieldClass} />
    </>
  );
}

/** The assistant wasn't sure what it heard: the customer types or fixes their details here. */
export function ContactForm({
  prefill,
  deliveryAreas,
  deliveryAreaId,
  note,
  accent,
  active,
  onSubmit,
}: {
  prefill: Partial<CustomerDetailsData>;
  deliveryAreas: Array<{ id: string; label: string }>;
  deliveryAreaId: string;
  note: string;
  accent: string;
  active: boolean;
  onSubmit: (message: string) => void;
}) {
  const [draft, setDraft] = useState<DetailDraft>({
    name: prefill.name ?? "",
    phone: prefill.phone ?? "",
    address: prefill.address ?? "",
    city: prefill.city ?? "",
  });
  const [area, setArea] = useState(deliveryAreaId || deliveryAreas[0]?.id || "");
  const [sent, setSent] = useState(false);
  if (!active || sent) {
    return <p className="text-[11.5px] text-stone-500">{sent ? "Details sent ✓" : "Form closed."}</p>;
  }
  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        const label = deliveryAreas.find((entry) => entry.id === area);
        setSent(true);
        onSubmit(detailsMessage("My delivery details", draft, label ? `${label.label} (id: ${label.id})` : undefined));
      }}
    >
      {note ? <p className="text-[11.5px] font-medium text-amber-700">{note}</p> : null}
      <DetailFields value={draft} onChange={setDraft} />
      {deliveryAreas.length > 0 ? (
        <select aria-label="Delivery area" value={area} onChange={(event) => setArea(event.target.value)} className={fieldClass}>
          {deliveryAreas.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      ) : null}
      <button type="submit" className="w-full rounded-lg py-2 text-[12.5px] font-semibold text-white transition hover:brightness-110" style={{ backgroundColor: accent }}>
        Send details
      </button>
    </form>
  );
}

/** Shown when an order has just been placed from the chat. */
export function OrderSuccessCard({ order, accent }: { order: OrderStatusData; accent: string }) {
  return (
    <div className="animate-pop overflow-hidden rounded-2xl border border-emerald-200 bg-white">
      <div className="bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 px-3.5 py-3 text-white">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/25" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <div>
            <p className="text-[14px] font-bold leading-tight">Order placed!</p>
            <p className="text-[11.5px] text-white/90">Thank you. We&apos;ll call you to confirm delivery.</p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 px-3.5 py-2.5 text-[11px]">
        <div>
          <p className="text-stone-400">Order no.</p>
          <p className="font-mono text-[12.5px] font-bold text-stone-900">{order.orderNumber}</p>
        </div>
        <div>
          <p className="text-stone-400">Total</p>
          <p className="text-[12.5px] font-bold text-stone-900">{formatMoney(order.totalMinor, order.currency)}</p>
        </div>
        <div>
          <p className="text-stone-400">Payment</p>
          <p className="text-[12.5px] font-semibold text-stone-900">{order.paymentMethod === "cod" ? "On delivery" : "Online"}</p>
        </div>
      </div>
      <ul className="border-t border-stone-100 px-3.5 py-2 text-[11.5px] text-stone-600">
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
      <p className="border-t border-stone-100 px-3.5 py-2 text-[10.5px]" style={{ color: accent }}>
        Ask me “where is my order?” any time to track it.
      </p>
    </div>
  );
}

/**
 * The order summary to confirm before a cash-on-delivery order is placed from the chat. The customer
 * confirms by tapping, or by saying so (the assistant then places it).
 */
export function OrderConfirmationCard({
  confirmation,
  accent,
  state,
  busy,
  onConfirm,
  onEdit,
}: {
  confirmation: OrderConfirmationData;
  accent: string;
  /** open: can be confirmed · placed: an order followed · stale: replaced by a newer summary */
  state: "open" | "placed" | "stale";
  busy: boolean;
  onConfirm: () => void;
  /** The customer corrected their details: sent back to the assistant as their message. */
  onEdit: (message: string) => void;
}) {
  const { customer } = confirmation;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: customer.name, phone: customer.phone, address: customer.address, city: customer.city });
  const saveEdits = () => {
    setEditing(false);
    onEdit(detailsMessage("Please update my order details", draft));
  };
  const itemCount = confirmation.lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <div className="animate-fade-up text-[12.5px]">
      {/* Where they are in the order: cart and details done, confirmation next. */}
      <ol className="mb-3 flex items-center gap-1.5 text-[10.5px] font-semibold" aria-label="Order progress">
        {["Cart", "Details", state === "placed" ? "Placed" : "Confirm"].map((step, index) => {
          const done = index < 2 || state === "placed";
          return (
            <li key={step} className="flex flex-1 items-center gap-1.5">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${done ? "text-white" : "bg-white ring-2"}`}
                style={done ? { backgroundColor: accent } : { color: accent, boxShadow: `inset 0 0 0 2px ${accent}` }}
              >
                {done ? (
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.2">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span className={done ? "text-stone-700" : ""} style={done ? undefined : { color: accent }}>
                {step}
              </span>
              {index < 2 ? <span className="h-px flex-1 bg-stone-200" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>

      <div className="rounded-2xl bg-stone-50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </p>
          <span className="rounded-full bg-white px-2 py-0.5 text-[10.5px] font-semibold text-stone-600 ring-1 ring-stone-200">Cash on delivery</span>
        </div>
        <ul className="space-y-2">
          {confirmation.lines.map((line, index) => (
            <li key={index} className="flex items-center gap-2.5">
              <span
                className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg px-1 text-[11px] font-bold"
                style={{ backgroundColor: `${accent}18`, color: accent }}
              >
                {line.quantity}×
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-stone-900">{line.name}</span>
                {line.variantTitle ? <span className="block truncate text-[11px] text-stone-500">{line.variantTitle}</span> : null}
              </span>
              <span className="shrink-0 font-semibold text-stone-900">{formatMoney(line.lineTotalMinor, confirmation.currency)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 space-y-1 border-t border-dashed border-stone-300 pt-2.5 text-stone-600">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatMoney(confirmation.subtotalMinor, confirmation.currency)}</span>
          </div>
          <div className="flex justify-between">
            <span>Delivery{confirmation.deliveryArea ? ` · ${confirmation.deliveryArea}` : ""}</span>
            <span className={confirmation.shippingMinor === 0 ? "font-semibold text-emerald-600" : ""}>
              {confirmation.shippingMinor === 0 ? "Free" : formatMoney(confirmation.shippingMinor, confirmation.currency)}
            </span>
          </div>
          <div className="flex items-baseline justify-between pt-1">
            <span className="font-semibold text-stone-900">Total</span>
            <span className="text-[19px] font-bold tracking-tight" style={{ color: accent }}>
              {formatMoney(confirmation.totalMinor, confirmation.currency)}
            </span>
          </div>
        </div>
      </div>

      {editing ? (
        <form
          className="mt-3 space-y-1.5 rounded-2xl bg-stone-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            saveEdits();
          }}
        >
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Delivery details</p>
          <DetailFields value={draft} onChange={setDraft} />
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex-1 rounded-xl border border-stone-200 bg-white py-2 text-[12px] font-medium text-stone-600"
            >
              Cancel
            </button>
            <button type="submit" className="flex-[1.4] rounded-xl py-2 text-[12px] font-semibold text-white" style={{ backgroundColor: accent }}>
              Save changes
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 rounded-2xl border border-stone-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Deliver to</p>
            {state === "open" ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition hover:bg-stone-100"
                style={{ color: accent }}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />
                </svg>
                Edit
              </button>
            ) : null}
          </div>
          <dl className="space-y-1.5 text-stone-700">
            {[
              { icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0", value: customer.name, strong: true },
              { icon: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2", value: customer.phone, mono: true },
              {
                icon: "M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
                value: [customer.address, customer.city].filter(Boolean).join(", "),
              },
            ].map((row) => (
              <div key={row.icon} className="flex items-start gap-2">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={row.icon} />
                </svg>
                <dd className={`min-w-0 ${row.strong ? "font-semibold text-stone-900" : ""} ${row.mono ? "font-mono tracking-wide" : ""}`}>{row.value}</dd>
              </div>
            ))}
            {customer.notes ? <p className="pl-5 text-[11.5px] text-stone-500">“{customer.notes}”</p> : null}
          </dl>
        </div>
      )}

      {state === "open" && !editing ? (
        <>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[14px] font-semibold text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
            style={{ backgroundColor: accent }}
          >
            {busy ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
            ) : (
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.6">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            )}
            {busy ? "Placing order…" : `Confirm order · ${formatMoney(confirmation.totalMinor, confirmation.currency)}`}
          </button>
          <p className="mt-1.5 text-center text-[11px] text-stone-400">Or just say “confirm”. You pay when it arrives.</p>
        </>
      ) : state !== "open" ? (
        <p className="mt-3 text-center text-[11.5px] text-stone-500">
          {state === "placed" ? "This order was placed." : "This summary was replaced by a newer one."}
        </p>
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
