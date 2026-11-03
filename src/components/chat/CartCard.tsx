"use client";

import Image from "next/image";
import { formatMoney } from "@/lib/client/format";
import type { CartPayload } from "@/types/chat";

/** The cart beside the voice panel: thumbnails, quantity steppers, subtotal and checkout. */
export function CartCard({
  cart,
  accent,
  busyItemId,
  checkoutBusy,
  onUpdate,
  onRemove,
  onCheckout,
}: {
  cart: CartPayload;
  accent: string;
  busyItemId: string | null;
  checkoutBusy: boolean;
  onUpdate: (itemId: string, quantity: number) => void;
  onRemove: (itemId: string) => void;
  onCheckout: () => void;
}) {
  if (cart.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-400" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="20" r="1.3" />
            <circle cx="18" cy="20" r="1.3" />
            <path d="M2.5 3h2.6l2.4 12h11l2-8.5H6.2" />
          </svg>
        </span>
        <p className="text-[13px] font-medium text-stone-700">Your cart is empty</p>
        <p className="text-[12px] text-stone-500">Tell me what you&apos;re looking for.</p>
      </div>
    );
  }

  return (
    <div data-testid="cart-summary" className="text-[12.5px]">
      <ul className="chat-scroll max-h-[min(18rem,45dvh)] space-y-2.5 overflow-y-auto pr-0.5">
        {cart.items.map((item) => {
          const busy = busyItemId === item.itemId;
          return (
            <li key={item.itemId} className={`flex items-center gap-3 transition ${busy ? "opacity-60" : ""}`}>
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-stone-100 to-stone-200">
                {item.imageUrl ? (
                  <Image src={item.imageUrl} alt="" fill sizes="56px" unoptimized className="object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-lg font-semibold text-stone-400">{item.name.charAt(0)}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-stone-900">{item.name}</p>
                <p className="truncate text-[11px] text-stone-500">
                  {item.variantTitle ? `${item.variantTitle} · ` : ""}
                  {formatMoney(item.unitPriceMinor, cart.currency)}
                  {item.available ? "" : " · unavailable"}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex items-center rounded-full bg-stone-100 p-0.5">
                    <button
                      type="button"
                      aria-label={`Decrease quantity of ${item.name}`}
                      onClick={() => onUpdate(item.itemId, item.quantity - 1)}
                      disabled={busy}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-stone-600 transition hover:bg-white disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-[12px] font-semibold tabular-nums text-stone-900">{item.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Increase quantity of ${item.name}`}
                      onClick={() => onUpdate(item.itemId, item.quantity + 1)}
                      disabled={busy}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-stone-600 transition hover:bg-white disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => onRemove(item.itemId)}
                    disabled={busy}
                    className="text-[11px] font-medium text-stone-400 transition hover:text-rose-600 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <p className="shrink-0 self-start font-semibold text-stone-900">{formatMoney(item.lineTotalMinor, cart.currency)}</p>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-baseline justify-between border-t border-dashed border-stone-300 pt-3">
        <span className="font-medium text-stone-600">
          Subtotal · {cart.itemCount} {cart.itemCount === 1 ? "item" : "items"}
        </span>
        <span className="text-[18px] font-bold tracking-tight" style={{ color: accent }}>
          {formatMoney(cart.subtotalMinor, cart.currency)}
        </span>
      </div>
      <button
        type="button"
        onClick={onCheckout}
        disabled={checkoutBusy}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[14px] font-semibold text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
        style={{ backgroundColor: accent }}
      >
        {checkoutBusy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" /> : null}
        {checkoutBusy ? "Opening checkout…" : "Checkout"}
        {!checkoutBusy ? (
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        ) : null}
      </button>
      <p className="mt-1.5 text-center text-[11px] text-stone-400">Or just say “order it” and I&apos;ll place it, cash on delivery.</p>
    </div>
  );
}
