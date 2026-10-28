"use client";

import { useActionState, useMemo, useState } from "react";
import { placeOrderAction, type PlaceOrderState } from "@/app/checkout/[token]/actions";
import { formatMoney } from "@/lib/client/format";

type Zone = { id: string; label: string; feeMinor: number };

type Props = {
  token: string;
  currency: string;
  subtotalMinor: number;
  zones: Zone[];
  freeShippingOverMinor: number | null;
  codEnabled: boolean;
  prefill: { name: string; phone: string; email: string; address: string; city: string; notes: string };
};

const inputClass =
  "mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-[13px] text-stone-900 placeholder:text-stone-400 transition focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/15";

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-[11.5px] font-medium text-stone-600">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-[11px] text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function CheckoutForm({ token, currency, subtotalMinor, zones, freeShippingOverMinor, codEnabled, prefill }: Props) {
  const [state, formAction, pending] = useActionState<PlaceOrderState, FormData>(placeOrderAction, {});
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? "");
  const errors = state.fieldErrors ?? {};

  const shippingMinor = useMemo(() => {
    const zone = zones.find((entry) => entry.id === zoneId);
    if (!zone) return 0;
    if (freeShippingOverMinor != null && subtotalMinor >= freeShippingOverMinor) return 0;
    return zone.feeMinor;
  }, [zones, zoneId, freeShippingOverMinor, subtotalMinor]);

  const describedBy = (field: string) => (errors[field] ? `${field}-error` : undefined);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="token" value={token} />

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-[13px] font-semibold text-stone-900">Delivery details</legend>
        <Field id="name" label="Full name" error={errors.name}>
          <input id="name" name="name" required autoComplete="name" defaultValue={prefill.name} className={inputClass} aria-invalid={Boolean(errors.name)} aria-describedby={describedBy("name")} />
        </Field>
        <Field id="phone" label="Phone" error={errors.phone}>
          <input id="phone" name="phone" required type="tel" autoComplete="tel" defaultValue={prefill.phone} className={inputClass} aria-invalid={Boolean(errors.phone)} aria-describedby={describedBy("phone")} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="address" label="Address" error={errors.address}>
            <textarea id="address" name="address" required rows={2} autoComplete="street-address" defaultValue={prefill.address} className={inputClass} aria-invalid={Boolean(errors.address)} aria-describedby={describedBy("address")} />
          </Field>
        </div>
        <Field id="city" label="City / area (optional)" error={errors.city}>
          <input id="city" name="city" autoComplete="address-level2" defaultValue={prefill.city} className={inputClass} />
        </Field>
        <Field id="email" label="Email (optional)" error={errors.email}>
          <input id="email" name="email" type="email" autoComplete="email" defaultValue={prefill.email} className={inputClass} aria-invalid={Boolean(errors.email)} aria-describedby={describedBy("email")} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="notes" label="Delivery notes (optional)">
            <input id="notes" name="notes" defaultValue={prefill.notes} placeholder="Landmark, preferred time…" className={inputClass} />
          </Field>
        </div>
      </fieldset>

      {zones.length > 0 ? (
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-stone-900">Delivery area</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {zones.map((zone) => (
              <label
                key={zone.id}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-[12.5px] transition ${
                  zoneId === zone.id ? "border-teal bg-teal/5 text-stone-900" : "border-stone-200 text-stone-600 hover:border-stone-300"
                }`}
              >
                <span className="flex items-center gap-2">
                  <input type="radio" name="shippingZoneId" value={zone.id} checked={zoneId === zone.id} onChange={() => setZoneId(zone.id)} className="accent-teal" />
                  {zone.label}
                </span>
                <span className="font-medium">{formatMoney(zone.feeMinor, currency)}</span>
              </label>
            ))}
          </div>
          {freeShippingOverMinor != null ? (
            <p className="mt-1.5 text-[11px] text-stone-500">Free delivery on orders over {formatMoney(freeShippingOverMinor, currency)}.</p>
          ) : null}
        </fieldset>
      ) : (
        <input type="hidden" name="shippingZoneId" value="" />
      )}

      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold text-stone-900">Payment</legend>
        <div className="grid gap-2">
          <label className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[12.5px] ${codEnabled ? "cursor-pointer border-teal bg-teal/5" : "border-stone-200 opacity-50"}`}>
            <input type="radio" name="paymentMethod" value="cod" defaultChecked={codEnabled} disabled={!codEnabled} className="accent-teal" />
            Cash on delivery
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-dashed border-stone-200 px-3 py-2.5 text-[12.5px] text-stone-400">
            <input type="radio" name="paymentMethod" value="online" disabled />
            Online payment (bKash, card): coming soon
          </label>
        </div>
      </fieldset>

      <div className="rounded-xl bg-stone-50 px-4 py-3 text-[12.5px]">
        <div className="flex justify-between text-stone-600">
          <span>Subtotal</span>
          <span>{formatMoney(subtotalMinor, currency)}</span>
        </div>
        <div className="mt-1 flex justify-between text-stone-600">
          <span>Delivery</span>
          <span>{shippingMinor === 0 && zones.length > 0 ? "Free" : formatMoney(shippingMinor, currency)}</span>
        </div>
        <div className="mt-2 flex justify-between border-t border-stone-200 pt-2 text-[14px] font-semibold text-stone-900">
          <span>Total</span>
          <span>{formatMoney(subtotalMinor + shippingMinor, currency)}</span>
        </div>
      </div>

      {state.error ? (
        <div role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-[12px] text-red-700 animate-fade-up">
          <p>{state.error}</p>
          {state.issues?.length ? (
            <ul className="mt-1 list-disc pl-4">
              {state.issues.map((issue) => (
                <li key={issue.name}>
                  {issue.name}: {issue.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending || !codEnabled}
        className="w-full rounded-xl bg-stone-900 px-4 py-3 text-[13.5px] font-semibold text-white transition hover:bg-stone-800 active:scale-[0.99] disabled:opacity-60"
      >
        {pending ? "Placing order…" : `Place order · ${formatMoney(subtotalMinor + shippingMinor, currency)}`}
      </button>
      <p className="text-center text-[10.5px] text-stone-400">
        By placing the order you agree to the store&apos;s delivery and return policies.
      </p>
    </form>
  );
}
