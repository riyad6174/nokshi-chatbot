import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderStatusBadge } from "@/components/dashboard/OrderStatusBadge";
import { requireAdmin } from "@/lib/auth/admin";
import { formatMinor } from "@/lib/money";
import { getCustomerForAdmin } from "@/modules/customers/admin.service";
import { STATUS_LABELS } from "@/modules/orders/order.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<string, string> = {
  viewed_product: "Viewed",
  added_to_cart: "Added to cart",
  removed_from_cart: "Removed from cart",
  checkout_started: "Started checkout",
  order_placed: "Placed an order",
  abandoned_cart: "Left a cart",
  voice_turn: "Talked to the voice assistant",
};

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const store = await getPrimaryStore();
  if (!store) notFound();
  const detail = await getCustomerForAdmin(store.id, id);
  if (!detail) notFound();
  const { profile, events, orders, conversations, productNames } = detail;
  const consent = profile.marketingConsent;

  // Collapse consecutive voice turns so the timeline stays readable.
  const timeline = events.filter(
    (event, index) => !(event.type === "voice_turn" && events[index + 1]?.type === "voice_turn"),
  );

  return (
    <div className="max-w-4xl">
      <Link href="/admin/customers" className="text-[11.5px] text-stone-500 hover:text-stone-800">
        ← All customers
      </Link>
      <h1 className="mt-2 font-serif text-2xl text-stone-900">{profile.name || "Anonymous visitor"}</h1>
      <p className="mt-1 text-[12px] text-stone-500">
        {[profile.phone, profile.email].filter(Boolean).join(" · ") || "No contact details yet"} · first seen{" "}
        {profile.firstSeenAt.toLocaleDateString("en-BD")}
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <section className="rounded-xl border border-stone-200 bg-white p-4 text-[12px]">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Value</h2>
          <p className="mt-2 text-xl font-semibold text-stone-900">{formatMinor(profile.totalSpentMinor, store.currency)}</p>
          <p className="text-stone-500">
            {profile.orderCount} {profile.orderCount === 1 ? "order" : "orders"}
            {profile.lastOrderAt ? ` · last ${profile.lastOrderAt.toLocaleDateString("en-BD")}` : ""}
          </p>
        </section>
        <section className="rounded-xl border border-stone-200 bg-white p-4 text-[12px]">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Interests</h2>
          <p className="mt-2 text-stone-800">{profile.interests.join(", ") || "Nothing noted yet"}</p>
          {profile.budgetHint ? <p className="mt-1 text-stone-500">Budget: {profile.budgetHint}</p> : null}
          {profile.preferredLocale ? <p className="mt-1 text-stone-500">Language: {profile.preferredLocale}</p> : null}
        </section>
        <section className="rounded-xl border border-stone-200 bg-white p-4 text-[12px]">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Marketing consent</h2>
          {consent ? (
            <>
              <p className={`mt-2 font-semibold ${consent.granted ? "text-emerald-700" : "text-stone-600"}`}>
                {consent.granted ? `Opted in: ${consent.channels.join(", ")}` : "Declined"}
              </p>
              <p className="mt-1 text-stone-500">
                {consent.at.toLocaleString("en-BD")} · via {consent.source}
              </p>
              <p className="mt-1.5 text-[11px] text-stone-500">Asked: “{consent.wording}”</p>
              {consent.evidence ? <p className="mt-1 text-[11px] text-stone-500">Answered: “{consent.evidence}”</p> : null}
            </>
          ) : (
            <p className="mt-2 text-stone-500">Not asked yet. Don&apos;t send marketing messages.</p>
          )}
        </section>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Activity</h2>
          {timeline.length === 0 ? (
            <p className="mt-2 text-[12px] text-stone-500">No activity recorded.</p>
          ) : (
            <ol className="mt-2 space-y-1.5 text-[12px]">
              {timeline.map((event) => (
                <li key={event.id} className="flex justify-between gap-3">
                  <span className="text-stone-800">
                    {EVENT_LABELS[event.type] ?? event.type}
                    {event.productId && productNames.get(event.productId) ? `: ${productNames.get(event.productId)}` : ""}
                    {event.valueMinor ? ` (${formatMinor(event.valueMinor, store.currency)})` : ""}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-stone-400">{event.at.toLocaleString("en-BD")}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <div className="space-y-4">
          <section className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Orders</h2>
            {orders.length === 0 ? (
              <p className="mt-2 text-[12px] text-stone-500">No orders yet.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-[12px]">
                {orders.map((order) => (
                  <li key={order.id} className="flex items-center justify-between gap-2">
                    <Link href={`/admin/orders/${order.id}`} className="font-mono font-semibold text-stone-900 hover:underline">
                      {order.orderNumber}
                    </Link>
                    <span className="text-stone-600">{formatMinor(order.totalMinor, order.currency)}</span>
                    <OrderStatusBadge status={order.status} label={STATUS_LABELS[order.status] ?? order.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Conversations</h2>
            {conversations.length === 0 ? (
              <p className="mt-2 text-[12px] text-stone-500">None.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-[12px]">
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <Link href={`/admin/inbox/${conversation.id}`} className="text-stone-800 hover:underline">
                      {conversation.lastMessageAt.toLocaleString("en-BD")}
                    </Link>
                    <span className="ml-2 text-[10.5px] text-stone-400">{conversation.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
