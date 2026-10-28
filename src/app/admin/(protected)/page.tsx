import Link from "next/link";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { prisma } from "@/lib/db/prisma";
import { resolveAiStatus } from "@/modules/ai/config";
import { allowedCheckoutHosts } from "@/modules/commerce/checkout-url";
import { getPrimaryStore, parseJsonArray, parseJsonObject } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const store = await getPrimaryStore();

  if (!store) {
    return (
      <div>
        <AdminBanner error={error || "No store is configured. Run npm run db:seed from the project root."} />
        <h1 className="font-serif text-2xl text-stone-900">Overview</h1>
      </div>
    );
  }

  const [productCount, activeCount, knowledgeCount, conversationCount, preparedCheckouts, recent] =
    await Promise.all([
      prisma.product.count({ where: { storeId: store.id } }),
      prisma.product.count({ where: { storeId: store.id, status: "active" } }),
      prisma.knowledgeDocument.count({ where: { storeId: store.id, status: "ready" } }),
      prisma.conversation.count({ where: { storeId: store.id } }),
      prisma.checkoutSession.count({ where: { storeId: store.id, status: "prepared" } }),
      prisma.conversation.findMany({
        where: { storeId: store.id },
        orderBy: { updatedAt: "desc" },
        take: 5,
        include: {
          session: { select: { visitorId: true, locale: true } },
          _count: { select: { messages: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true } },
        },
      }),
    ]);

  const theme = parseJsonObject(store.settings?.widgetTheme);
  const locales = parseJsonArray(store.supportedLocales);

  return (
    <div>
      <AdminBanner error={error} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-stone-900">Overview</h1>
          <p className="mt-1 text-[12px] text-stone-500">
            {store.name} · {locales.join(" / ")} · {store.currency}
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="rounded-lg bg-stone-900 px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-stone-800"
        >
          Add product
        </Link>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Products", value: productCount, detail: `${activeCount} active` },
          { label: "Knowledge docs", value: knowledgeCount, detail: "ready for retrieval" },
          { label: "Conversations", value: conversationCount, detail: "all time" },
          { label: "Checkouts prepared", value: preparedCheckouts, detail: "awaiting handoff" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-stone-400">{stat.label}</p>
            <p className="mt-1.5 text-2xl font-semibold text-stone-900">{stat.value}</p>
            <p className="mt-0.5 text-[10.5px] text-stone-400">{stat.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-stone-900">Recent conversations</h2>
            <Link href="/admin/conversations" className="text-[11px] font-medium text-stone-500 hover:text-stone-800">
              View all
            </Link>
          </div>

          {recent.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-stone-300 px-4 py-6 text-center text-[11.5px] text-stone-500">
              No conversations yet. Open the storefront and start a chat.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-stone-100">
              {recent.map((conversation) => (
                <li key={conversation.id}>
                  <Link
                    href={`/admin/conversations/${conversation.id}`}
                    className="flex items-start gap-3 py-2.5 transition hover:bg-stone-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-stone-800">
                        {conversation.messages[0]?.content || "No messages yet"}
                      </p>
                      <p className="mt-0.5 text-[10.5px] text-stone-400">
                        {conversation.session.visitorId.slice(0, 8)}… · {conversation.session.locale} ·{" "}
                        {conversation._count.messages} messages · {new Date(conversation.updatedAt).toLocaleString()}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-stone-500">
                      {conversation.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-[13px] font-semibold text-stone-900">Widget &amp; AI</h2>
          <dl className="mt-3 space-y-2.5 text-[11.5px]">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-stone-500">Public widget key</dt>
              <dd className="rounded bg-stone-100 px-2 py-0.5 font-mono text-[10.5px] text-stone-700">{store.widgetKey}</dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-stone-500">AI mode</dt>
              <dd>
                {resolveAiStatus(store.settings).config ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    Live · {resolveAiStatus(store.settings).model}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    Demo rules
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-stone-500">Accent</dt>
              <dd className="flex items-center gap-1.5 font-mono text-[10.5px] text-stone-700">
                <span
                  className="inline-block h-3 w-3 rounded-full border border-stone-300"
                  style={{ backgroundColor: typeof theme.accent === "string" ? theme.accent : "#0f766e" }}
                />
                {typeof theme.accent === "string" ? theme.accent : "#0f766e"}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-stone-500">Checkout hosts</dt>
              <dd className="text-right text-[10.5px] text-stone-600">
                {allowedCheckoutHosts(store).join(", ")}
              </dd>
            </div>
          </dl>
          {!resolveAiStatus(store.settings).config ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[10.5px] leading-relaxed text-amber-800">
              No AI model is connected, so the widget uses a demo responder over the real catalog.{" "}
              <Link href="/admin/ai" className="font-semibold underline underline-offset-2">
                Connect a model
              </Link>
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/admin/settings"
              className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 hover:bg-stone-50"
            >
              Widget settings
            </Link>
            <Link
              href="/admin/chatbot"
              className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 hover:bg-stone-50"
            >
              Configure chatbot
            </Link>
            <Link
              href="/"
              target="_blank"
              className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 hover:bg-stone-50"
            >
              Open storefront
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
