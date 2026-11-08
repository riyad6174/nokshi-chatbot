import Link from "next/link";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { requireAdmin } from "@/lib/auth/admin";
import { formatMinor } from "@/lib/money";
import { PERIODS, storeAnalytics } from "@/modules/analytics/analytics.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

const pct = (value: number | null) => (value == null ? "—" : `${Math.round(value * 1000) / 10}%`);
const secs = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tabular-nums text-stone-900">{value}</p>
      {detail ? <p className="mt-0.5 text-[11px] text-stone-500">{detail}</p> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-[13px] font-semibold text-stone-900">{title}</h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function RankTable({ title, rows, empty, valueLabel = "Count" }: { title: string; rows: Array<{ value: string; count: number }>; empty: string; valueLabel?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <h3 className="text-[12px] font-semibold text-stone-900">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-[11.5px] text-stone-500">{empty}</p>
      ) : (
        <table className="mt-1 w-full text-[12px]">
          <thead className="sr-only">
            <tr>
              <th scope="col">Item</th>
              <th scope="col">{valueLabel}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((row) => (
              <tr key={row.value}>
                <td className="py-1 pr-2 text-stone-800">{row.value}</td>
                <td className="py-1 text-right tabular-nums text-stone-600">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdmin();
  const { days: rawDays } = await searchParams;
  const store = await getPrimaryStore();
  if (!store) return <AdminBanner error="No store configured. Run npm run db:seed." />;
  const days = PERIODS.find((period) => String(period) === rawDays) ?? 30;
  const data = await storeAnalytics(store.id, days);
  const money = (minor: number | null) => (minor == null ? "—" : formatMinor(minor, store.currency));

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-stone-900">Analytics</h1>
          <p className="mt-1 text-[12px] text-stone-500">
            {store.name} · last {days} days (since {new Date(data.since).toLocaleDateString("en-BD")})
          </p>
        </div>
        <nav aria-label="Reporting period" className="flex gap-1">
          {PERIODS.map((period) => (
            <Link
              key={period}
              href={`/admin/analytics?days=${period}`}
              aria-current={period === days ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-medium ${period === days ? "bg-stone-900 text-white" : "border border-stone-300 text-stone-700 hover:bg-stone-50"}`}
            >
              {period} days
            </Link>
          ))}
        </nav>
      </div>

      <Section title="Sales">
        <Tile label="Orders" value={String(data.sales.orders)} />
        <Tile label="Revenue" value={money(data.sales.revenueMinor)} />
        <Tile label="Average order" value={money(data.sales.averageOrderMinor)} />
        <Tile label="Conversations" value={String(data.conversations)} />
      </Section>

      <Section title="Conversion">
        <Tile label="Search → purchase" value={pct(data.search.conversion)} detail={`${data.search.purchased} of ${data.search.sessions} searching sessions`} />
        <Tile label="Cart → checkout" value={pct(data.funnel.cartToCheckout)} detail={`${data.funnel.checkoutSessions} of ${data.funnel.cartSessions} sessions with a cart`} />
        <Tile label="Cart → order" value={pct(data.funnel.cartToOrder)} detail={`${data.funnel.orderSessions} sessions ordered`} />
        <Tile
          label="Abandoned carts recovered"
          value={pct(data.abandoned.recoveryRate)}
          detail={`${data.abandoned.recovered} of ${data.abandoned.carts} (${data.abandoned.recoveredAfterReminder} after a reminder)`}
        />
      </Section>

      <Section title="Recommendations & engagement">
        <Tile label="Suggestions shown" value={String(data.recommendations.shown)} detail={`${data.recommendations.clicked} clicked`} />
        <Tile label="Added to cart" value={pct(data.recommendations.addRate)} detail={`${data.recommendations.addedToCart} additions from suggestions`} />
        <Tile label="Purchased" value={pct(data.recommendations.purchaseRate)} detail={`${data.recommendations.purchased} suggested products bought`} />
        <Tile
          label="Proactive messages"
          value={String(data.engagement.proactiveShown)}
          detail={`${data.engagement.dismissed} dismissed · ${data.engagement.optOuts} opt-outs`}
        />
      </Section>

      <Section title="AI assistant">
        <Tile label="Answered" value={pct(data.ai.successRate)} detail={`${data.ai.turns} turns · ${data.ai.missed ?? 0} missed · ${data.ai.error ?? 0} errors`} />
        <Tile label="Handed to a person" value={pct(data.ai.handoffRate)} detail={`${data.ai.handoff ?? 0} turns`} />
        <Tile label="Tool errors" value={pct(data.ai.toolErrorRate)} detail={`${data.ai.toolErrors} of ${data.ai.toolCalls} tool calls`} />
        <Tile label="Response time" value={secs(data.ai.latencyP50Ms)} detail={`p95 ${secs(data.ai.latencyP95Ms)} · first word ${secs(data.ai.firstTokenP50Ms)}`} />
      </Section>

      <Section title="Human agents">
        <Tile label="Handoffs" value={String(data.agents.handoffs)} detail={`${data.agents.answered} answered by staff`} />
        <Tile
          label="First response"
          value={data.agents.medianFirstResponseMinutes == null ? "—" : `${Math.round(data.agents.medianFirstResponseMinutes)} min`}
          detail="median after handoff"
        />
        <Tile label="Resolved" value={String(data.agents.resolved)} detail="closed or handed back" />
        <Tile label="Most active" value={data.agents.byAgent[0]?.name ?? "—"} detail={data.agents.byAgent[0] ? `${data.agents.byAgent[0].replies} replies` : undefined} />
      </Section>

      <section className="mt-6 grid gap-3 md:grid-cols-2">
        <RankTable title="Frequently searched" rows={data.search.topSearches} empty="No searches yet." valueLabel="Searches" />
        <RankTable title="Searched but not in the catalog" rows={data.gaps.missingProducts} empty="Every search found something." valueLabel="Searches" />
        <RankTable title="Policy questions without an answer (add Knowledge)" rows={data.gaps.missingKnowledge} empty="No gaps found." valueLabel="Questions" />
        <RankTable title="Most common tool errors" rows={data.ai.topToolErrors} empty="No tool errors." valueLabel="Errors" />
      </section>

      <section className="mt-3 rounded-xl border border-stone-200 bg-white p-4">
        <h3 className="text-[12px] font-semibold text-stone-900">Unanswered customer questions</h3>
        {data.gaps.unanswered.length === 0 ? (
          <p className="mt-1 text-[11.5px] text-stone-500">None in this period.</p>
        ) : (
          <ul className="mt-1 divide-y divide-stone-100 text-[12px]">
            {data.gaps.unanswered.map((entry) => (
              <li key={`${entry.at}-${entry.text}`} className="flex justify-between gap-3 py-1">
                <span className="text-stone-800">“{entry.text}”</span>
                <span className="shrink-0 text-[11px] text-stone-500">
                  {entry.outcome} · {new Date(entry.at).toLocaleDateString("en-BD")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
