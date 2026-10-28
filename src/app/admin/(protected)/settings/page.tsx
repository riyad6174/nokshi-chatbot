import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { updateDeliverySettingsAction, updateStoreSettingsAction } from "@/app/admin/actions";
import { parseShippingZones } from "@/modules/orders/order.service";
import { requireAdmin } from "@/lib/auth/admin";
import Link from "next/link";
import { env } from "@/lib/config/env";
import { resolveAiStatus } from "@/modules/ai/config";
import { getPrimaryStore, parseJsonArray } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

const inputClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[12px] text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none";
const labelClass = "text-[10.5px] font-medium text-stone-500";

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { saved, error } = await searchParams;
  const store = await getPrimaryStore();
  if (!store) return <AdminBanner error="No store configured. Run npm run db:seed." />;

  const settings = store.settings;
  const locales = parseJsonArray(store.supportedLocales);
  const trustedCheckoutHosts = parseJsonArray(store.trustedCheckoutHosts);
  const ai = resolveAiStatus(settings);
  const zones = parseShippingZones(store.shippingZones);

  return (
    <div className="max-w-3xl">
      <AdminBanner error={error} saved={saved} savedMessage="Settings saved." />

      <h1 className="font-serif text-2xl text-stone-900">Settings</h1>
      <p className="mt-1 text-[12px] text-stone-500">
        Store identity, localization, and assistant behaviour. Changes are live on the next request.
      </p>

      <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-[13px] font-semibold text-stone-900">Store</h2>
        <form action={updateStoreSettingsAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="store-name" className={labelClass}>
              Store name
            </label>
            <input id="store-name" name="name" required defaultValue={store.name} className={inputClass} />
          </div>
          <div>
            <label htmlFor="store-domain" className={labelClass}>
              Public website domain
            </label>
            <input
              id="store-domain"
              name="websiteDomain"
              required
              defaultValue={store.websiteDomain}
              className={inputClass}
              placeholder="example.com"
            />
          </div>
          <div>
            <label htmlFor="store-currency" className={labelClass}>
              Currency (ISO 4217)
            </label>
            <input
              id="store-currency"
              name="currency"
              required
              minLength={3}
              maxLength={3}
              defaultValue={store.currency}
              className={`${inputClass} uppercase`}
            />
          </div>
          <div>
            <label htmlFor="store-default-locale" className={labelClass}>
              Default locale
            </label>
            <input
              id="store-default-locale"
              name="defaultLocale"
              required
              defaultValue={store.defaultLocale}
              className={inputClass}
              placeholder="en"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="store-locales" className={labelClass}>
              Supported locales (comma separated)
            </label>
            <input
              id="store-locales"
              name="supportedLocales"
              required
              defaultValue={locales.join(", ")}
              className={inputClass}
              placeholder="en, bn"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="store-hosts" className={labelClass}>
              Extra trusted checkout hosts (comma separated)
            </label>
            <input
              id="store-hosts"
              name="trustedCheckoutHosts"
              defaultValue={trustedCheckoutHosts.join(", ")}
              className={inputClass}
              placeholder="shop.example.com, checkout.example.com"
            />
            <p className="mt-1 text-[9.5px] leading-relaxed text-stone-400">
              The assistant may only hand off to the website domain, the app base URL host, and these hosts.
              HTTPS is required outside localhost.
            </p>
          </div>

          <div className="sm:col-span-2 rounded-lg bg-stone-50 px-3 py-2 text-[10.5px] leading-relaxed text-stone-500">
            Public widget key: <span className="font-mono text-stone-700">{store.widgetKey}</span> · AI mode:{" "}
            <span className="font-semibold text-stone-700">{ai.config ? "live" : "demo rules"}</span> ·{" "}
            <Link href="/admin/chatbot" className="underline underline-offset-2">
              Configure chatbot
            </Link>
          </div>

          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-lg bg-stone-900 px-3.5 py-2 text-[11.5px] font-semibold text-white transition hover:bg-stone-800"
            >
              Save store settings
            </button>
          </div>
        </form>
      </section>

      <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-[13px] font-semibold text-stone-900">Delivery &amp; payment</h2>
        <p className="mt-0.5 text-[10.5px] text-stone-400">Used by the checkout page and quoted by the assistant.</p>
        <form action={updateDeliverySettingsAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="zones" className={labelClass}>
              Delivery areas: one per line as &quot;Area = fee&quot;
            </label>
            <textarea
              id="zones"
              name="zones"
              rows={3}
              defaultValue={zones.map((zone) => `${zone.label} = ${zone.feeMinor / 100}`).join("\n")}
              placeholder={"Inside Dhaka (2-3 days) = 80\nOutside Dhaka (3-5 days) = 150"}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label htmlFor="freeShippingOver" className={labelClass}>
              Free delivery on orders over ({store.currency}, optional)
            </label>
            <input
              id="freeShippingOver"
              name="freeShippingOver"
              inputMode="decimal"
              defaultValue={store.freeShippingOverMinor != null ? String(store.freeShippingOverMinor / 100) : ""}
              className={inputClass}
            />
          </div>
          <label className="mt-5 flex items-center gap-2 text-[12px] text-stone-800">
            <input type="checkbox" name="codEnabled" defaultChecked={store.codEnabled} /> Accept cash on delivery
          </label>
          <p className="text-[10.5px] text-stone-400 sm:col-span-2">
            Online payment (bKash, cards) needs a payment gateway; until one is connected, checkout offers cash on delivery only.
          </p>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-lg bg-stone-900 px-3.5 py-2 text-[11.5px] font-semibold text-white transition hover:bg-stone-800"
            >
              Save delivery &amp; payment
            </button>
          </div>
        </form>
      </section>

      <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-[13px] font-semibold text-stone-900">Environment</h2>
        <dl className="mt-2 space-y-1.5 text-[10.5px]">
          <div className="flex justify-between gap-3">
            <dt className="text-stone-500">App base URL</dt>
            <dd className="font-mono text-stone-700">{env.APP_BASE_URL}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-stone-500">AI model</dt>
            <dd className="font-mono text-stone-700">{ai.config ? `${ai.providerId} · ${ai.model}` : "not connected"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-stone-500">Commerce provider</dt>
            <dd className="font-mono text-stone-700">{env.COMMERCE_PROVIDER}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
