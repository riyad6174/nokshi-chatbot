import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { OrderStatusBadge } from "@/components/dashboard/OrderStatusBadge";
import { updateOrderStatusAction } from "@/app/admin/order-actions";
import { requireAdmin } from "@/lib/auth/admin";
import { formatMinor } from "@/lib/money";
import { STATUS_LABELS, allowedNextStatuses, getOrderForAdmin } from "@/modules/orders/order.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

const inputClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[12px] text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none";
const labelClass = "text-[10.5px] font-medium text-stone-500";

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { saved, error } = await searchParams;
  const store = await getPrimaryStore();
  if (!store) notFound();
  const order = await getOrderForAdmin(store.id, id);
  if (!order) notFound();

  const next = allowedNextStatuses(order.status);

  return (
    <div className="max-w-3xl">
      <AdminBanner error={error} saved={saved} savedMessage="Order updated. The customer sees the new status in their chat." />
      <Link href="/admin/orders" className="text-[11.5px] text-stone-500 hover:text-stone-800">
        ← All orders
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-semibold text-stone-900">{order.orderNumber}</h1>
        <OrderStatusBadge status={order.status} label={STATUS_LABELS[order.status] ?? order.status} />
      </div>
      <p className="mt-1 text-[11.5px] text-stone-500">Placed {order.createdAt.toLocaleString("en-BD")}</p>

      <div className="mt-5 grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-[13px] font-semibold text-stone-900">Items</h2>
          <ul className="mt-2 divide-y divide-stone-100 text-[12.5px]">
            {order.items.map((item) => (
              <li key={`${item.productId}-${item.variantId ?? ""}`} className="flex justify-between gap-3 py-2">
                <span>
                  {item.quantity} × {item.name}
                  {item.variantTitle ? <span className="text-stone-500"> ({item.variantTitle})</span> : null}
                  {item.sku ? <span className="block font-mono text-[10.5px] text-stone-400">{item.sku}</span> : null}
                </span>
                <span className="font-medium">{formatMinor(item.lineTotalMinor, order.currency)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-2 space-y-1 border-t border-stone-200 pt-2 text-[12px]">
            <div className="flex justify-between text-stone-600">
              <dt>Subtotal</dt>
              <dd>{formatMinor(order.subtotalMinor, order.currency)}</dd>
            </div>
            <div className="flex justify-between text-stone-600">
              <dt>Delivery{order.shippingZone ? ` (${order.shippingZone})` : ""}</dt>
              <dd>{order.shippingMinor === 0 ? "Free" : formatMinor(order.shippingMinor, order.currency)}</dd>
            </div>
            <div className="flex justify-between font-semibold text-stone-900">
              <dt>Total</dt>
              <dd>{formatMinor(order.totalMinor, order.currency)}</dd>
            </div>
            <div className="flex justify-between text-stone-600">
              <dt>Payment</dt>
              <dd>
                {order.paymentMethod === "cod" ? "Cash on delivery" : "Online"} · {order.paymentStatus}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-5 text-[12px]">
          <h2 className="text-[13px] font-semibold text-stone-900">Customer</h2>
          <p className="mt-2 font-medium text-stone-900">{order.customer.name}</p>
          <p className="text-stone-600">
            <a href={`tel:${order.customer.phone}`} className="underline-offset-2 hover:underline">
              {order.customer.phone}
            </a>
          </p>
          {order.customer.email ? <p className="text-stone-600">{order.customer.email}</p> : null}
          <p className="mt-2 whitespace-pre-line text-stone-700">
            {order.customer.address}
            {order.customer.city ? `\n${order.customer.city}` : ""}
          </p>
          {order.customer.notes ? <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-amber-900">Note: {order.customer.notes}</p> : null}
          {order.conversationId ? (
            <Link href={`/admin/inbox/${order.conversationId}`} className="mt-3 inline-block font-semibold text-stone-800 underline underline-offset-2">
              Open chat
            </Link>
          ) : null}
        </section>
      </div>

      <section className="mt-4 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-[13px] font-semibold text-stone-900">Update status</h2>
        {next.length === 0 ? (
          <p className="mt-2 text-[12px] text-stone-500">This order is {STATUS_LABELS[order.status]?.toLowerCase()} and can&apos;t change further.</p>
        ) : (
          <form action={updateOrderStatusAction} className="mt-3 grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="orderId" value={order.id} />
            <div>
              <label htmlFor="status" className={labelClass}>
                New status
              </label>
              <select id="status" name="status" defaultValue={next[0]} className={inputClass}>
                {next.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="trackingNumber" className={labelClass}>
                Tracking number (optional)
              </label>
              <input id="trackingNumber" name="trackingNumber" defaultValue={order.trackingNumber} className={inputClass} />
            </div>
            <div>
              <label htmlFor="note" className={labelClass}>
                Note to customer (optional)
              </label>
              <input id="note" name="note" placeholder="e.g. Handed to Pathao courier" className={inputClass} />
            </div>
            <div className="sm:col-span-3">
              <button type="submit" className="rounded-lg bg-stone-900 px-3.5 py-2 text-[11.5px] font-semibold text-white hover:bg-stone-800">
                Update order
              </button>
              <p className="mt-1 text-[10.5px] text-stone-400">Cancelling puts the reserved stock back.</p>
            </div>
          </form>
        )}

        <h3 className="mt-5 text-[12px] font-semibold text-stone-800">History</h3>
        <ol className="mt-2 space-y-2 border-l-2 border-stone-200 pl-3 text-[11.5px]">
          {[...order.statusHistory].reverse().map((event, index) => (
            <li key={`${event.status}-${index}`}>
              <span className="font-semibold text-stone-800">{STATUS_LABELS[event.status] ?? event.status}</span>{" "}
              <span className="text-stone-400">
                · {event.at.toLocaleString("en-BD")} · {event.by}
              </span>
              {event.note ? <p className="text-stone-600">{event.note}</p> : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
