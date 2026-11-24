import Link from "next/link";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { saveModelPricingAction } from "@/app/admin/ai-usage-actions";
import { requireAdmin } from "@/lib/auth/admin";
import { resolveAiStatus } from "@/modules/ai/config";
import { listModelPricing } from "@/modules/ai/pricing.service";
import { storeUsage, USAGE_PERIODS } from "@/modules/analytics/usage.service";
import { getAdminPageStore } from "@/modules/stores/admin-store";
import { formatDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`;
const tokens = (value: number) => value.toLocaleString("en-US");

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tabular-nums text-stone-900">{value}</p>
      {detail ? <p className="mt-0.5 text-[11px] text-stone-500">{detail}</p> : null}
    </div>
  );
}

function CostBadge({ unpriced }: { unpriced: number }) {
  return unpriced > 0 ? (
    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
      {unpriced} unpriced
    </span>
  ) : (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800">priced</span>
  );
}

export default async function AiUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; pricing?: string; saved?: string; error?: string; repriced?: string }>;
}) {
  await requireAdmin();
  const { days: rawDays, pricing: editingId, saved, error, repriced: rawRepriced } = await searchParams;
  const repriced = Number.parseInt(rawRepriced ?? "0", 10) || 0;
  const store = await getAdminPageStore();
  if (!store) return <AdminBanner error="No store configured. Run npm run db:seed." />;

  const period = USAGE_PERIODS.find((value) => String(value) === rawDays) ?? 30;
  const [data, pricingRows] = await Promise.all([storeUsage(store.id, period), listModelPricing()]);
  const editing = pricingRows.find((row) => row.id === editingId) ?? null;
  const status = resolveAiStatus(store.settings);
  const hasUsage = data.totals.events > 0;
  const promptTokens =
    data.totals.inputTokens + data.totals.cachedInputTokens + data.totals.cacheWriteInputTokens;
  const cacheHitRate = promptTokens > 0 ? data.totals.cachedInputTokens / promptTokens : null;

  return (
    <div className="max-w-6xl">
      <AdminBanner
        error={error}
        saved={saved}
        savedMessage={
          repriced > 0
            ? `Model pricing saved. ${repriced} earlier request${repriced === 1 ? " was" : "s were"} priced with it, and conversation costs are updated.`
            : "Model pricing saved. New usage uses it immediately."
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-stone-900">AI usage &amp; cost</h1>
          <p className="mt-1 text-[12px] text-stone-500">
            {store.name} · last {period} days (since {formatDate(data.since)}). Costs are
            estimated in USD from the pricing rows below.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/api/admin/ai-usage/export?days=${period}`}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-[12px] font-medium text-stone-700 hover:bg-stone-50"
          >
            Export CSV
          </Link>
          <nav aria-label="Reporting period" className="flex gap-1">
            {USAGE_PERIODS.map((value) => (
              <Link
                key={value}
                href={`/admin/ai-usage?days=${value}`}
                aria-current={value === period ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 text-[12px] font-medium ${
                  value === period
                    ? "bg-stone-900 text-white"
                    : "border border-stone-300 text-stone-700 hover:bg-stone-50"
                }`}
              >
                {value} days
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile
          label="Estimated spend"
          value={usd(data.totals.costMicros)}
          detail={`${data.totals.pricedEvents} priced · ${data.totals.unpricedEvents} unpriced requests`}
        />
        <Tile
          label="Tokens"
          value={tokens(data.totals.totalTokens)}
          detail={`${tokens(data.totals.inputTokens)} input · ${tokens(data.totals.outputTokens)} output`}
        />
        <Tile
          label="AI requests"
          value={tokens(data.totals.events)}
          detail={`${tokens(data.totals.cachedInputTokens)} cached input · ${
            cacheHitRate == null ? "—" : `${Math.round(cacheHitRate * 1000) / 10}% cache hit`
          }`}
        />
        <Tile label="Conversations" value={tokens(data.totals.conversations)} detail="with recorded usage" />
        <Tile
          label="Per chat message"
          value={data.perTurn.callsPerTurn == null ? "—" : `${Math.round(data.perTurn.callsPerTurn * 10) / 10} AI calls`}
          detail={
            data.perTurn.promptTokensPerTurn == null
              ? "no AI chat turns yet"
              : `${tokens(data.perTurn.promptTokensPerTurn)} prompt tokens · ${tokens(data.perTurn.turns)} turns`
          }
        />
      </section>

      {data.totals.unpricedEvents > 0 ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11.5px] text-amber-900">
          {data.totals.unpricedEvents} request{data.totals.unpricedEvents === 1 ? "" : "s"} had no matching price,
          so their cost is excluded from the estimate. Add a price below for{" "}
          {[...new Set(data.unpriced.map((row) => `${row.providerId} / ${row.model}`))].map((name, index) => (
            <span key={name}>
              {index > 0 ? ", " : ""}
              <code className="font-mono font-semibold">{name}</code>
            </span>
          ))}
          ; earlier requests are priced as soon as you save it.
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {data.byChannel.map((row) => (
          <div key={row.key} className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-stone-500">{row.label}</p>
            <p className="mt-1 text-[18px] font-semibold tabular-nums text-stone-900">{usd(row.costMicros)}</p>
            <p className="mt-0.5 text-[11px] text-stone-500">
              {tokens(row.events)} requests · {tokens(row.totalTokens)} tokens
            </p>
          </div>
        ))}
      </div>

      <section className="mt-5 rounded-xl border border-stone-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
          <h2 className="text-[13px] font-semibold text-stone-900">Cost by model</h2>
          <span className="text-[10.5px] text-stone-500">Sorted by token volume</span>
        </div>
        {data.byModel.length === 0 ? (
          <p className="px-4 py-3 text-[11.5px] text-stone-500">No AI usage recorded in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-stone-50 text-left text-[10px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 font-medium">Requests</th>
                  <th className="px-4 py-2 text-right font-medium">Input</th>
                  <th className="px-4 py-2 text-right font-medium">Output</th>
                  <th className="px-4 py-2 text-right font-medium">Tokens</th>
                  <th className="px-4 py-2 text-right font-medium">Cost</th>
                  <th className="px-4 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.byModel.map((row) => (
                  <tr key={row.key}>
                    <td className="max-w-[260px] truncate px-4 py-2 font-mono text-[11px] text-stone-800">
                      {row.label}
                    </td>
                    <td className="px-4 py-2 tabular-nums text-stone-600">{tokens(row.events)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-600">{tokens(row.inputTokens)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-600">{tokens(row.outputTokens)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-800">{tokens(row.totalTokens)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium text-stone-900">
                      {usd(row.costMicros)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <CostBadge unpriced={row.unpricedEvents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-5 rounded-xl border border-stone-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
          <h2 className="text-[13px] font-semibold text-stone-900">Daily usage</h2>
          <span className="text-[10.5px] text-stone-500">USD estimates</span>
        </div>
        {data.days.length === 0 ? (
          <p className="px-4 py-3 text-[11.5px] text-stone-500">No daily usage yet.</p>
        ) : (
          <div className="max-h-[320px] overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-stone-50 text-left text-[10px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Requests</th>
                  <th className="px-4 py-2 text-right font-medium">Tokens</th>
                  <th className="px-4 py-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {[...data.days].reverse().map((row) => (
                  <tr key={row.date}>
                    <td className="px-4 py-1.5 tabular-nums text-stone-700">{row.date}</td>
                    <td className="px-4 py-1.5 tabular-nums text-stone-600">{tokens(row.events)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-stone-600">{tokens(row.totalTokens)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-stone-900">{usd(row.costMicros)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-5 rounded-xl border border-stone-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
          <h2 className="text-[13px] font-semibold text-stone-900">Top conversations by cost</h2>
          <span className="text-[10.5px] text-stone-500">Last {period} days</span>
        </div>
        {data.topConversations.length === 0 ? (
          <p className="px-4 py-3 text-[11.5px] text-stone-500">No conversation usage in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-stone-50 text-left text-[10px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Conversation</th>
                  <th className="px-4 py-2 font-medium">Requests</th>
                  <th className="px-4 py-2 text-right font-medium">Tokens</th>
                  <th className="px-4 py-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.topConversations.map((conversation) => (
                  <tr key={conversation.conversationId}>
                    <td className="px-4 py-1.5">
                      <Link
                        href={`/admin/inbox/${conversation.conversationId}`}
                        className="font-medium text-stone-800 underline-offset-2 hover:underline"
                      >
                        {conversation.name}
                      </Link>
                      <span className="ml-1.5 text-[10px] text-stone-400">{conversation.status}</span>
                    </td>
                    <td className="px-4 py-1.5 tabular-nums text-stone-600">{tokens(conversation.events)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-stone-600">
                      {tokens(conversation.totalTokens)}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums font-medium text-stone-900">
                      {usd(conversation.costMicros)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-[13px] font-semibold text-stone-900">Model pricing</h2>
        <p className="mt-0.5 text-[10.5px] text-stone-400">
          Rates are USD per one million tokens. A model can be an exact name, a prefix, or <code>*</code> for a
          provider-wide fallback. Usage without a matching row stays unpriced instead of guessing.
        </p>

        <form action={saveModelPricingAction} className="mt-3 grid gap-3 rounded-xl border border-stone-200 bg-stone-50/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <div>
            <label htmlFor="pricing-provider" className="text-[10.5px] font-medium text-stone-500">
              Provider ID
            </label>
            <input
              id="pricing-provider"
              name="providerId"
              required
              defaultValue={editing?.providerId ?? status.providerId ?? "openai"}
              placeholder="openai"
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-[12px] text-stone-900"
            />
          </div>
          <div>
            <label htmlFor="pricing-model" className="text-[10.5px] font-medium text-stone-500">
              Model or pattern
            </label>
            <input
              id="pricing-model"
              name="model"
              required
              defaultValue={editing?.model ?? status.model ?? ""}
              placeholder="gpt-4.1-mini"
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-[12px] text-stone-900"
            />
          </div>
          <div>
            <label htmlFor="pricing-input" className="text-[10.5px] font-medium text-stone-500">
              Input / 1M
            </label>
            <input
              id="pricing-input"
              name="inputPerMillion"
              type="number"
              step="0.000001"
              min="0"
              required
              defaultValue={editing?.inputPerMillion ?? 0}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-[12px] text-stone-900"
            />
          </div>
          <div>
            <label htmlFor="pricing-cached" className="text-[10.5px] font-medium text-stone-500">
              Cached input / 1M
            </label>
            <input
              id="pricing-cached"
              name="cachedInputPerMillion"
              type="number"
              step="0.000001"
              min="0"
              required
              defaultValue={editing?.cachedInputPerMillion ?? 0}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-[12px] text-stone-900"
            />
          </div>
          <div>
            <label htmlFor="pricing-cache-write" className="text-[10.5px] font-medium text-stone-500">
              Cache write / 1M
            </label>
            <input
              id="pricing-cache-write"
              name="cacheWritePerMillion"
              type="number"
              step="0.000001"
              min="0"
              required
              defaultValue={editing?.cacheWritePerMillion ?? 0}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-[12px] text-stone-900"
            />
          </div>
          <div>
            <label htmlFor="pricing-output" className="text-[10.5px] font-medium text-stone-500">
              Output / 1M
            </label>
            <input
              id="pricing-output"
              name="outputPerMillion"
              type="number"
              step="0.000001"
              min="0"
              required
              defaultValue={editing?.outputPerMillion ?? 0}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-[12px] text-stone-900"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <p className="text-[10.5px] font-medium text-stone-500">
              Audio rates (optional, for voice models like gpt-realtime). Leave empty to price audio like text.
            </p>
            <div className="mt-1 grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["audioInputPerMillion", "Audio input / 1M", editing?.audioInputPerMillion],
                  ["cachedAudioInputPerMillion", "Cached audio input / 1M", editing?.cachedAudioInputPerMillion],
                  ["audioOutputPerMillion", "Audio output / 1M", editing?.audioOutputPerMillion],
                ] as const
              ).map(([name, label, value]) => (
                <div key={name}>
                  <label htmlFor={`pricing-${name}`} className="text-[10.5px] font-medium text-stone-500">
                    {label}
                  </label>
                  <input
                    id={`pricing-${name}`}
                    name={name}
                    type="number"
                    step="0.000001"
                    min="0"
                    placeholder="same as text"
                    defaultValue={value ?? ""}
                    className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-[12px] text-stone-900"
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-2">
            <label htmlFor="pricing-note" className="text-[10.5px] font-medium text-stone-500">
              Note (optional)
            </label>
            <input
              id="pricing-note"
              name="note"
              defaultValue={editing?.note ?? ""}
              placeholder="Provider price list, checked 2026-11-17"
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[12px] text-stone-900"
            />
          </div>
          <label className="flex items-end gap-2 pb-1.5 text-[11px] text-stone-700">
            <input type="checkbox" name="active" defaultChecked={editing?.active ?? true} className="h-3.5 w-3.5" />
            Active
          </label>
          <div className="flex items-end gap-2 pb-0.5 lg:col-span-4">
            <button className="rounded-lg bg-stone-900 px-3.5 py-2 text-[11.5px] font-semibold text-white transition hover:bg-stone-800">
              {editing ? "Save pricing" : "Add pricing"}
            </button>
            {editing ? (
              <Link
                href={`/admin/ai-usage?days=${period}`}
                className="rounded-lg border border-stone-300 px-3.5 py-2 text-[11.5px] font-semibold text-stone-700 hover:bg-white"
              >
                Cancel
              </Link>
            ) : null}
          </div>
        </form>

        {pricingRows.length === 0 ? (
          <p className="mt-3 text-[11.5px] text-stone-500">No pricing rows yet. Add one above to start estimating cost.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="text-left text-[10px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Provider / model</th>
                  <th className="px-3 py-1.5 text-right font-medium">Input</th>
                  <th className="px-3 py-1.5 text-right font-medium">Cached</th>
                  <th className="px-3 py-1.5 text-right font-medium">Write</th>
                  <th className="px-3 py-1.5 text-right font-medium">Output</th>
                  <th className="px-3 py-1.5 text-right font-medium">Audio in / cached / out</th>
                  <th className="px-3 py-1.5 text-right font-medium">Status</th>
                  <th className="py-1.5 pl-3 text-right font-medium">
                    <span className="sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {pricingRows.map((row) => (
                  <tr key={row.id}>
                    <td className="py-1.5 pr-3">
                      <span className="font-mono text-[11px] text-stone-800">
                        {row.providerId} / {row.model}
                      </span>
                      {row.note ? <p className="text-[10px] text-stone-400">{row.note}</p> : null}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-[11px] text-stone-600">
                      ${row.inputPerMillion}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-[11px] text-stone-600">
                      ${row.cachedInputPerMillion}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-[11px] text-stone-600">
                      ${row.cacheWritePerMillion}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-[11px] text-stone-600">
                      ${row.outputPerMillion}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-[11px] text-stone-600">
                      {row.audioInputPerMillion == null &&
                      row.cachedAudioInputPerMillion == null &&
                      row.audioOutputPerMillion == null
                        ? "as text"
                        : [row.audioInputPerMillion, row.cachedAudioInputPerMillion, row.audioOutputPerMillion]
                            .map((rate) => (rate == null ? "text" : `$${rate}`))
                            .join(" / ")}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          row.active ? "bg-emerald-50 text-emerald-800" : "bg-stone-100 text-stone-500"
                        }`}
                      >
                        {row.active ? "active" : "inactive"}
                      </span>
                    </td>
                    <td className="py-1.5 pl-3 text-right">
                      <Link
                        href={`/admin/ai-usage?days=${period}&pricing=${row.id}`}
                        className="text-[11px] font-medium underline-offset-2 hover:underline"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!hasUsage ? (
        <p className="mt-4 text-[11px] text-stone-500">
          Usage appears after an AI reply or a live voice response. Existing conversations are not backfilled.
        </p>
      ) : null}
    </div>
  );
}
