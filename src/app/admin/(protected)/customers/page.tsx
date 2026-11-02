import Link from "next/link";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { requireAdmin } from "@/lib/auth/admin";
import { formatMinor } from "@/lib/money";
import {
  CUSTOMER_FILTERS,
  countCustomers,
  listCustomersForAdmin,
  type CustomerFilter,
} from "@/modules/customers/admin.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

const FILTER_LABELS: Record<CustomerFilter, string> = {
  all: "All",
  opted_in: "Marketing opt-in",
  buyers: "Buyers",
  abandoned: "Abandoned cart",
};

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string }> }) {
  await requireAdmin();
  const { filter: rawFilter, q = "" } = await searchParams;
  const store = await getPrimaryStore();
  if (!store) return <AdminBanner error="No store configured. Run npm run db:seed." />;

  const filter = (CUSTOMER_FILTERS as readonly string[]).includes(rawFilter ?? "") ? (rawFilter as CustomerFilter) : "all";
  const [customers, counts] = await Promise.all([listCustomersForAdmin(store.id, filter, q), countCustomers(store.id)]);
  const hrefFor = (key: CustomerFilter) => {
    const params = new URLSearchParams();
    if (key !== "all") params.set("filter", key);
    if (q) params.set("q", q);
    const query = params.toString();
    return `/admin/customers${query ? `?${query}` : ""}`;
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-stone-900">Customers</h1>
          <p className="mt-1 max-w-xl text-[12px] text-stone-500">
            Shoppers the assistant has talked to: what they like, what they bought, and whether they agreed to marketing.
            Only opted-in customers may receive offers.
          </p>
        </div>
        {/* A file download from a route handler, not a page: Link would try client navigation. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/admin/customers/export"
          download
          className="rounded-lg bg-stone-900 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-stone-700"
        >
          Export opted-in (CSV)
        </a>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <nav aria-label="Filter customers" className="flex flex-wrap gap-1.5">
          {CUSTOMER_FILTERS.map((key) => (
            <Link
              key={key}
              href={hrefFor(key)}
              aria-current={filter === key ? "page" : undefined}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                filter === key ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:ring-stone-300"
              }`}
            >
              {FILTER_LABELS[key]} <span className="opacity-60">{counts[key]}</span>
            </Link>
          ))}
        </nav>
        <form className="ml-auto" action="/admin/customers">
          {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search name, phone, email, interest"
            className="w-64 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[12px] focus:border-stone-500 focus:outline-none"
          />
        </form>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-stone-200 bg-white">
        {customers.length === 0 ? (
          <p className="p-6 text-center text-[12px] text-stone-500">No customers here yet.</p>
        ) : (
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <thead className="border-b border-stone-200 bg-stone-50 text-[10.5px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Interests</th>
                <th className="px-3 py-2 text-right font-medium">Orders</th>
                <th className="px-3 py-2 text-right font-medium">Spent</th>
                <th className="px-3 py-2 font-medium">Marketing</th>
                <th className="px-3 py-2 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {customers.map((customer) => (
                <tr key={customer.id} className="transition hover:bg-stone-50">
                  <td className="px-3 py-2.5">
                    <Link href={`/admin/customers/${customer.id}`} className="font-medium text-stone-900 underline-offset-2 hover:underline">
                      {customer.name || "Anonymous visitor"}
                    </Link>
                    <p className="text-[10.5px] text-stone-500">{[customer.phone, customer.email].filter(Boolean).join(" · ") || "No contact yet"}</p>
                  </td>
                  <td className="max-w-[220px] px-3 py-2.5 text-stone-600">
                    <p className="truncate">{[...customer.interests].reverse().slice(0, 4).join(", ") || "—"}</p>
                    {customer.budgetHint ? <p className="text-[10.5px] text-stone-400">Budget: {customer.budgetHint}</p> : null}
                  </td>
                  <td className="px-3 py-2.5 text-right text-stone-700">{customer.orderCount}</td>
                  <td className="px-3 py-2.5 text-right text-stone-700">
                    {customer.totalSpentMinor ? formatMinor(customer.totalSpentMinor, store.currency) : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    {customer.marketingConsent?.granted ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">
                        Opted in · {customer.marketingConsent.channels.join(", ")}
                      </span>
                    ) : customer.marketingConsent ? (
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10.5px] font-medium text-stone-500">Declined</span>
                    ) : (
                      <span className="text-[10.5px] text-stone-400">Not asked</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-stone-500">{customer.lastSeenAt.toLocaleString("en-BD")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
