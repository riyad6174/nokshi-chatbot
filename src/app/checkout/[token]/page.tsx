import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckoutForm } from "@/components/checkout/CheckoutForm";
import { prisma } from "@/lib/db/prisma";
import { formatMinor } from "@/lib/money";
import type { CheckoutLineSnapshot } from "@/modules/commerce/commerce-adapter";
import { getCheckoutByToken } from "@/modules/commerce/checkout.service";
import { STATUS_LABELS, parseShippingZones } from "@/modules/orders/order.service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Secure checkout",
  robots: { index: false, follow: false },
};

function parseLines(value: string): CheckoutLineSnapshot[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as CheckoutLineSnapshot[]) : [];
  } catch {
    return [];
  }
}

function Shell({ storeName, children }: { storeName: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-sand">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 py-4">
          <Link href="/" className="font-serif text-lg font-semibold text-stone-900">
            {storeName}
          </Link>
          <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-stone-500">
            Secure checkout
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-5 py-8">{children}</main>
    </div>
  );
}

export default async function CheckoutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const checkout = await getCheckoutByToken(token);
  if (!checkout) notFound();

  const store = checkout.store;
  const lines = parseLines(checkout.lines);
  const order = checkout.orderId ? await prisma.order.findUnique({ where: { id: checkout.orderId } }) : null;

  if (order) {
    return (
      <Shell storeName={store.name}>
        <div className="mx-auto max-w-xl rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm animate-fade-up">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 animate-pop">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="m5 13 4 4L19 7" />
            </svg>
          </div>
          <h1 className="mt-4 font-serif text-2xl text-stone-900">Thank you, {order.customer.name.split(" ")[0]}!</h1>
          <p className="mt-1 text-[13px] text-stone-600">
            Your order <span className="font-mono font-semibold text-stone-900">{order.orderNumber}</span> has been placed.
          </p>
          <div className="mx-auto mt-5 max-w-sm rounded-xl bg-stone-50 px-4 py-3 text-left text-[12.5px] text-stone-600">
            {order.items.map((item) => (
              <div key={`${item.productId}-${item.variantId ?? ""}`} className="flex justify-between gap-3 py-0.5">
                <span>
                  {item.quantity} × {item.name}
                  {item.variantTitle ? ` (${item.variantTitle})` : ""}
                </span>
                <span>{formatMinor(item.lineTotalMinor, order.currency)}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-stone-200 pt-1.5">
              <span>Delivery</span>
              <span>{order.shippingMinor === 0 ? "Free" : formatMinor(order.shippingMinor, order.currency)}</span>
            </div>
            <div className="mt-1 flex justify-between font-semibold text-stone-900">
              <span>Total ({order.paymentMethod === "cod" ? "cash on delivery" : "online"})</span>
              <span>{formatMinor(order.totalMinor, order.currency)}</span>
            </div>
          </div>
          <p className="mt-4 text-[12px] text-stone-500">
            Status: <span className="font-semibold text-stone-800">{STATUS_LABELS[order.status] ?? order.status}</span>. Ask
            the chat assistant about <span className="font-mono">{order.orderNumber}</span> any time for updates.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-full bg-teal px-5 py-2.5 text-[12.5px] font-semibold text-white transition hover:brightness-110"
          >
            Continue shopping
          </Link>
        </div>
      </Shell>
    );
  }

  const expired =
    checkout.status !== "prepared" || (checkout.expiresAt ? checkout.expiresAt.getTime() < Date.now() : false);
  if (expired) {
    return (
      <Shell storeName={store.name}>
        <div className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
          <h1 className="font-serif text-2xl text-stone-900">This checkout link expired</h1>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-stone-600">
            Checkout links are short-lived, and they close if your cart changes. Open the chat or your cart and start
            checkout again.
          </p>
          <Link href="/" className="mt-6 inline-block rounded-full bg-teal px-5 py-2.5 text-[12.5px] font-semibold text-white">
            Return to the store
          </Link>
        </div>
      </Shell>
    );
  }

  const customer = checkout.customer;
  return (
    <Shell storeName={store.name}>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm animate-fade-up">
          <h1 className="font-serif text-2xl text-stone-900">Checkout</h1>
          <p className="mt-1 text-[12px] text-stone-500">
            {customer ? "We've filled in the details you gave in chat. Check them before placing the order." : "Where should we deliver?"}
          </p>
          <div className="mt-5">
            <CheckoutForm
              token={token}
              currency={checkout.currency}
              subtotalMinor={checkout.subtotalMinor}
              zones={parseShippingZones(store.shippingZones)}
              freeShippingOverMinor={store.freeShippingOverMinor}
              codEnabled={store.codEnabled}
              prefill={{
                name: customer?.name ?? "",
                phone: customer?.phone ?? "",
                email: customer?.email ?? "",
                address: customer?.address ?? "",
                city: customer?.city ?? "",
                notes: customer?.notes ?? "",
              }}
            />
          </div>
        </section>

        <aside className="h-fit rounded-2xl border border-stone-200 bg-white p-6 shadow-sm lg:sticky lg:top-6">
          <h2 className="text-[13px] font-semibold text-stone-900">Your order</h2>
          <ul className="mt-3 divide-y divide-stone-100">
            {lines.map((line) => (
              <li key={`${line.productId}-${line.variantId ?? "default"}`} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-stone-900">{line.name}</p>
                  <p className="text-[11.5px] text-stone-500">
                    {line.variantTitle ? `${line.variantTitle} · ` : ""}Qty {line.quantity}
                  </p>
                </div>
                <p className="shrink-0 text-[13px] font-semibold text-stone-900">
                  {formatMinor(line.lineTotalMinor, checkout.currency)}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10.5px] text-stone-400">
            Prices were re-checked when this checkout was created. Link expires{" "}
            {checkout.expiresAt ? checkout.expiresAt.toLocaleTimeString("en-BD", { hour: "2-digit", minute: "2-digit" }) : "soon"}.
          </p>
        </aside>
      </div>
    </Shell>
  );
}
