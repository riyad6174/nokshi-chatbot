import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { ConfirmSubmitButton } from "@/components/dashboard/ConfirmSubmitButton";
import { createCampaignAction, launchCampaignAction, setCampaignStatusAction } from "@/app/admin/marketing-actions";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { MARKETING_CHANNELS, type MarketingChannel } from "@/modules/marketing/consent";
import { parseSegment, previewSegment } from "@/modules/marketing/segments";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

const inputClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[12px] text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none";
const labelClass = "text-[10.5px] font-medium text-stone-500";

const KIND_LABELS: Record<string, string> = {
  abandoned_cart: "Abandoned-cart reminder (automation)",
  product_followup: "Product follow-up (one-off)",
  broadcast: "Broadcast (one-off)",
};

function describeSegment(value: string): string {
  const segment = parseSegment(value);
  const parts = [
    segment.minOrders != null && `${segment.minOrders}+ orders`,
    segment.maxOrders != null && `≤ ${segment.maxOrders} orders`,
    segment.seenWithinDays != null && `seen in last ${segment.seenWithinDays} days`,
    segment.inactiveForDays != null && `inactive ${segment.inactiveForDays}+ days`,
    segment.spentAtLeastMinor != null && `spent ≥ ${segment.spentAtLeastMinor / 100}`,
    segment.interestsAny?.length && `interested in ${segment.interestsAny.join(", ")}`,
    segment.categoriesAny?.length && `browsed ${segment.categoriesAny.join(", ")}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "All customers";
}

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  await requireAdmin();
  const params = await searchParams;
  const store = await getPrimaryStore();
  if (!store) return <AdminBanner error="No store configured. Run npm run db:seed." />;

  const [campaigns, recent, consenting, unsubscribed] = await Promise.all([
    prisma.marketingCampaign.findMany({ where: { storeId: store.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.marketingMessage.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { campaign: { select: { name: true } }, profile: { select: { name: true } } },
    }),
    prisma.customerProfile.count({ where: { storeId: store.id, marketingConsent: { is: { granted: true } }, unsubscribedAt: null } }),
    prisma.customerProfile.count({ where: { storeId: store.id, unsubscribedAt: { not: null } } }),
  ]);
  const stats = await Promise.all(
    campaigns.map(async (campaign) => {
      const [sent, clicked, skipped, audience] = await Promise.all([
        prisma.marketingMessage.count({ where: { campaignId: campaign.id, status: "sent" } }),
        prisma.marketingMessage.count({ where: { campaignId: campaign.id, clickedAt: { not: null } } }),
        prisma.marketingMessage.count({ where: { campaignId: campaign.id, status: "skipped" } }),
        campaign.status === "draft" ? previewSegment(store.id, parseSegment(campaign.segment), campaign.channel as MarketingChannel) : Promise.resolve(null),
      ]);
      return { sent, clicked, skipped, audience };
    }),
  );
  const provider = (process.env.MARKETING_PROVIDER ?? "log").toLowerCase();

  return (
    <div className="max-w-4xl">
      <AdminBanner error={params.error} saved={params.saved} savedMessage={params.saved && params.saved !== "1" ? params.saved : "Saved."} />
      <h1 className="font-serif text-2xl text-stone-900">Marketing</h1>
      <p className="mt-1 text-[12px] text-stone-500">
        Messages go only to customers who said yes to marketing on that channel, and every message has an unsubscribe link. Order
        updates are separate and unaffected. {consenting} customer{consenting === 1 ? "" : "s"} can be messaged · {unsubscribed} unsubscribed.
      </p>
      {provider === "log" ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900">
          Dry-run mode: messages are logged, not sent. Set MARKETING_PROVIDER to <code>webhook</code> or <code>resend</code> to deliver them.
        </p>
      ) : null}

      <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-[13px] font-semibold text-stone-900">Campaigns</h2>
        {campaigns.length === 0 ? (
          <p className="mt-2 text-[12px] text-stone-500">No campaigns yet. Start with an abandoned-cart reminder below.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="text-[10.5px] uppercase tracking-wide text-stone-400">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Campaign</th>
                  <th className="py-1.5 pr-3 font-medium">Audience</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 font-medium">Sent · clicked · skipped</th>
                  <th className="py-1.5 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {campaigns.map((campaign, index) => (
                  <tr key={campaign.id}>
                    <td className="py-2 pr-3">
                      <p className="font-medium text-stone-900">{campaign.name}</p>
                      <p className="text-[11px] text-stone-500">
                        {KIND_LABELS[campaign.kind]} · {campaign.channel}
                      </p>
                    </td>
                    <td className="py-2 pr-3 text-[11px] text-stone-600">
                      {campaign.kind === "abandoned_cart" ? `Carts idle 2 h, then +${campaign.delayMinutes} min` : describeSegment(campaign.segment)}
                      {stats[index]?.audience ? (
                        <span className="block text-stone-500">
                          {stats[index]!.audience!.reachable} reachable of {stats[index]!.audience!.matched}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 capitalize text-stone-700">{campaign.status}</td>
                    <td className="py-2 pr-3 text-stone-700">
                      {stats[index]?.sent ?? 0} · {stats[index]?.clicked ?? 0} · {stats[index]?.skipped ?? 0}
                    </td>
                    <td className="py-2 text-right">
                      {campaign.status === "draft" ? (
                        <form action={launchCampaignAction}>
                          <input type="hidden" name="campaignId" value={campaign.id} />
                          <ConfirmSubmitButton
                            confirmMessage={campaign.kind === "abandoned_cart" ? "Turn on this automation?" : "Send this campaign to its audience now?"}
                            className="rounded-lg bg-stone-900 px-2.5 py-1.5 text-[11px] font-semibold text-white"
                          >
                            {campaign.kind === "abandoned_cart" ? "Turn on" : "Send"}
                          </ConfirmSubmitButton>
                        </form>
                      ) : campaign.kind === "abandoned_cart" ? (
                        <form action={setCampaignStatusAction}>
                          <input type="hidden" name="campaignId" value={campaign.id} />
                          <input type="hidden" name="status" value={campaign.status === "active" ? "paused" : "active"} />
                          <button type="submit" className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-[11px] font-semibold text-stone-700">
                            {campaign.status === "active" ? "Pause" : "Resume"}
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-[13px] font-semibold text-stone-900">New campaign</h2>
        <form action={createCampaignAction} className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className={labelClass}>
              Name
            </label>
            <input id="name" name="name" required maxLength={120} className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="kind" className={labelClass}>
                Type
              </label>
              <select id="kind" name="kind" className={inputClass} defaultValue="abandoned_cart">
                {Object.entries(KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="channel" className={labelClass}>
                Channel
              </label>
              <select id="channel" name="channel" className={inputClass} defaultValue="sms">
                {MARKETING_CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="subject" className={labelClass}>
              Subject (email)
            </label>
            <input id="subject" name="subject" maxLength={150} placeholder="{name}, you left something at {store}" className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="body" className={labelClass}>
              Message — placeholders {"{name}"} {"{store}"} {"{cart}"} {"{products}"} {"{link}"}; an unsubscribe link is added automatically
            </label>
            <textarea
              id="body"
              name="body"
              required
              rows={4}
              maxLength={2000}
              defaultValue={"Hi {name}, your {cart} is still waiting at {store}. Complete your order: {link}"}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="delayMinutes" className={labelClass}>
              Abandoned cart: wait (minutes) after the cart is flagged
            </label>
            <input id="delayMinutes" name="delayMinutes" type="number" min={15} max={10080} defaultValue={60} className={inputClass} />
          </div>
          <fieldset className="sm:col-span-2 grid gap-2 rounded-lg border border-stone-200 p-3 sm:grid-cols-3">
            <legend className="px-1 text-[10.5px] font-medium text-stone-500">Audience (one-off campaigns; empty = everyone who consented)</legend>
            {(
              [
                ["minOrders", "Min orders"],
                ["maxOrders", "Max orders"],
                ["spentAtLeast", `Spent at least (${store.currency})`],
                ["seenWithinDays", "Seen in last N days"],
                ["inactiveForDays", "Inactive for N+ days"],
              ] as const
            ).map(([name, label]) => (
              <div key={name}>
                <label htmlFor={name} className={labelClass}>
                  {label}
                </label>
                <input id={name} name={name} type="number" min={0} className={inputClass} />
              </div>
            ))}
            <div>
              <label htmlFor="interestsAny" className={labelClass}>
                Interests (comma separated)
              </label>
              <input id="interestsAny" name="interestsAny" className={inputClass} />
            </div>
            <div className="sm:col-span-3">
              <label htmlFor="categoriesAny" className={labelClass}>
                Browsed or added these categories in the last 30 days (comma separated)
              </label>
              <input id="categoriesAny" name="categoriesAny" className={inputClass} />
            </div>
          </fieldset>
          <div className="sm:col-span-2 flex justify-end">
            <button type="submit" className="rounded-lg bg-stone-900 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-stone-800">
              Create draft
            </button>
          </div>
        </form>
      </section>

      <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-[13px] font-semibold text-stone-900">Recent messages</h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-[12px] text-stone-500">Nothing sent yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-stone-100 text-[12px]">
            {recent.map((message) => (
              <li key={message.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                <span>
                  <span className="font-medium text-stone-900">{message.profile.name || "Customer"}</span> · {message.campaign.name} · {message.channel}
                </span>
                <span className="text-[11px] text-stone-500">
                  {message.status}
                  {message.reason ? ` (${message.reason})` : ""}
                  {message.clickedAt ? " · clicked" : ""} · {message.createdAt.toLocaleString("en-BD")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
