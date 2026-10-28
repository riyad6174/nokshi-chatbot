"use client";

import { formatMoney } from "@/lib/client/format";
import { CheckoutButton } from "@/components/chat/CheckoutButton";
import type { CartPayload } from "@/types/chat";

type CartSummaryProps = {
  cart: CartPayload;
  accent: string;
  busyItemId?: string | null;
  checkoutBusy?: boolean;
  onUpdate: (itemId: string, quantity: number) => void;
  onRemove: (itemId: string) => void;
  onCheckout?: () => void;
  showCheckout?: boolean;
  compact?: boolean;
};

export function CartSummary({
  cart,
  accent,
  busyItemId,
  checkoutBusy,
  onUpdate,
  onRemove,
  onCheckout,
  showCheckout = true,
  compact = false,
}: CartSummaryProps) {
  if (cart.items.length === 0) {
    return (
      <div
        data-testid="cart-empty"
        className="mt-2 rounded-xl border border-dashed border-stone-300 bg-stone-50 p-3 text-[12px] text-stone-500"
      >
        Your cart is empty. Add a product and I&apos;ll keep track of it here.
      </div>
    );
  }

  return (
    <div data-testid="cart-summary" className="mt-2 w-full rounded-xl border border-stone-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-stone-500">Your cart</p>
        <p className="text-[11px] text-stone-500">
          {cart.itemCount} {cart.itemCount === 1 ? "item" : "items"}
        </p>
      </div>

      <ul className={`mt-2 space-y-2.5 ${compact ? "" : "max-h-56 overflow-y-auto chat-scroll pr-0.5"}`}>
        {cart.items.map((item) => {
          const busy = busyItemId === item.itemId;
          return (
            <li key={item.itemId} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium text-stone-900">{item.name}</p>
                <p className="text-[11px] text-stone-500">
                  {item.variantTitle ? `${item.variantTitle} · ` : ""}
                  {formatMoney(item.unitPriceMinor, cart.currency)} each
                  {item.available ? "" : " · unavailable"}
                </p>
                <div className="mt-1 flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={`Decrease quantity of ${item.name}`}
                    onClick={() => onUpdate(item.itemId, item.quantity - 1)}
                    disabled={busy}
                    className="h-6 w-6 rounded-md border border-stone-200 text-sm leading-none text-stone-600 hover:bg-stone-50 disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-[12px] tabular-nums">{item.quantity}</span>
                  <button
                    type="button"
                    aria-label={`Increase quantity of ${item.name}`}
                    onClick={() => onUpdate(item.itemId, item.quantity + 1)}
                    disabled={busy}
                    className="h-6 w-6 rounded-md border border-stone-200 text-sm leading-none text-stone-600 hover:bg-stone-50 disabled:opacity-40"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => onRemove(item.itemId)}
                    disabled={busy}
                    className="ml-1 text-[11px] font-medium text-stone-500 underline-offset-2 hover:text-red-600 hover:underline disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <p className="shrink-0 text-[12.5px] font-semibold text-stone-900">
                {formatMoney(item.lineTotalMinor, cart.currency)}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-2.5">
        <span className="text-[12px] font-medium text-stone-600">Subtotal</span>
        <span className="text-[13.5px] font-semibold text-stone-900">
          {formatMoney(cart.subtotalMinor, cart.currency)}
        </span>
      </div>
      <p className="mt-0.5 text-[10.5px] text-stone-500">Taxes and shipping are calculated at checkout.</p>

      {showCheckout && onCheckout ? (
        <div className="mt-2.5">
          <CheckoutButton
            onClick={onCheckout}
            busy={checkoutBusy}
            accent={accent}
            subtotalMinor={cart.subtotalMinor}
            currency={cart.currency}
            showCaption={false}
          />
        </div>
      ) : null}
    </div>
  );
}
