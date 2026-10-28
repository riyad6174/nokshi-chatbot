import Link from "next/link";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { OrderStatusBadge } from "@/components/dashboard/OrderStatusBadge";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { formatMinor } from "@/lib/money";
import { ORDER_STATUSES, STATUS_LABELS, listOrdersForAdmin } from "@/modules/orders/order.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const { status } = await searchParams;
  const store = await getPrimaryStore();
  if (!store) return <AdminBanner error="No store configured. Run npm run db:seed." />;

  const filter = status && (ORDER_STATUSES as readonly string[]).includes(status) ? status : "all";
  const [orders, grouped] = await Promise.all([
    listOrdersForAdmin(store.id, filter),
    prisma.order.groupBy({ by: ["status"], where: { storeId: store.id }, _count: { _all: true } }),
  ]);
  const countFor = (key: string) => grouped.find((group) => group.status === key)?._count._all ?? 0;
  const total = grouped.reduce((sum, group) => sum + group._count._all, 0);

  return (
    <div>
      <h1 className="font-serif text-2xl text-stone-900">Orders</h1>
      <p className="mt-1 text-[12px] text-stone-500">
        Orders placed from the chat and checkout. Status changes are shown to the customer in their chat.
      </p>

      <nav aria-label="Filter orders" className="mt-4 flex flex-wrap gap-1.5">
        {["all", ...ORDER_STATUSES].map((key) => {
          const count = key === "all" ? total : countFor(key);
          const active = filter === key;
          return (
            <Link
              key={key}
              href={key === "all" ? "/admin/orders" : `/admin/orders?status=${key}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                active ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:ring-stone-300"
              }`}
            >
              {key === "all" ? "All" : STATUS_LABELS[key]} <span className="opacity-60">{count}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 overflow-x-auto rounded-xl border border-stone-200 bg-white">
        {orders.length === 0 ? (
          <p className="p-6 text-center text-[12px] text-stone-500">No orders here yet.</p>
        ) : (
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead className="border-b border-stone-200 bg-stone-50 text-[10.5px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2 font-medium">Order</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Items</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Payment</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {orders.map((order) => (
                <tr key={order.id} className="transition hover:bg-stone-50">
                  <td className="px-3 py-2.5">
                    <Link href={`/admin/orders/${order.id}`} className="font-mono font-semibold text-stone-900 underline-offset-2 hover:underline">
                      {order.orderNumber}
                    </Link>
                    <p className="text-[10.5px] text-stone-400">{order.createdAt.toLocaleString("en-BD")}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="text-stone-800">{order.customer.name}</p>
                    <p className="text-[10.5px] text-stone-500">{order.customer.phone}</p>
                  </td>
                  <td className="px-3 py-2.5 text-stone-600">{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-stone-900">{formatMinor(order.totalMinor, order.currency)}</td>
                  <td className="px-3 py-2.5 text-stone-600">
                    {order.paymentMethod === "cod" ? "COD" : "Online"} · {order.paymentStatus}
                  </td>
                  <td className="px-3 py-2.5">
                    <OrderStatusBadge status={order.status} label={STATUS_LABELS[order.status] ?? order.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
