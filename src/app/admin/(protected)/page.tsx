import Link from "next/link";
import type { IconType } from "react-icons";
import {
  LuArrowRight,
  LuArrowUpRight,
  LuBookOpen,
  LuBot,
  LuCpu,
  LuExternalLink,
  LuGauge,
  LuInbox,
  LuKey,
  LuMailCheck,
  LuMessagesSquare,
  LuMic,
  LuPackage,
  LuPalette,
  LuPlus,
  LuShoppingBag,
  LuShoppingCart,
  LuSparkles,
  LuWallet,
} from "react-icons/lu";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { prisma } from "@/lib/db/prisma";
import { formatMinor } from "@/lib/money";
import { resolveAiStatus } from "@/modules/ai/config";
import { storeUsage } from "@/modules/analytics/usage.service";
import { allowedCheckoutHosts } from "@/modules/commerce/checkout-url";
import { salesStats } from "@/modules/customers/events.service";
import { getPrimaryStore, parseJsonArray, parseJsonObject } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

type Tone = "teal" | "violet" | "amber" | "sky" | "rose" | "emerald";

const TONES: Record<Tone, { tile: string; glow: string }> = {
  teal: {
    tile: "from-[#f3e1b8] via-[#d8b878] to-[#b18c4b] text-[#191307] shadow-black/40",
    glow: "bg-[#d8b878]/[0.07]",
  },
  violet: {
    tile: "from-[#f3e1b8] via-[#d8b878] to-[#b18c4b] text-[#191307] shadow-black/40",
    glow: "bg-[#d8b878]/[0.07]",
  },
  amber: {
    tile: "from-[#f3e1b8] via-[#d8b878] to-[#b18c4b] text-[#191307] shadow-black/40",
    glow: "bg-[#d8b878]/[0.07]",
  },
  sky: {
    tile: "from-[#f3e1b8] via-[#d8b878] to-[#b18c4b] text-[#191307] shadow-black/40",
    glow: "bg-[#d8b878]/[0.07]",
  },
  rose: {
    tile: "from-[#f3e1b8] via-[#d8b878] to-[#b18c4b] text-[#191307] shadow-black/40",
    glow: "bg-[#d8b878]/[0.07]",
  },
  emerald: {
    tile: "from-[#f3e1b8] via-[#d8b878] to-[#b18c4b] text-[#191307] shadow-black/40",
    glow: "bg-[#d8b878]/[0.07]",
  },
};

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
  href,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: IconType;
  tone: Tone;
  href?: string;
}) {
  const body = (
    <>
      <span className={`pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full blur-2xl ${TONES[tone].glow}`} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-stone-500">{label}</p>
          <p className="mt-2 text-[26px] font-semibold leading-none tracking-tight text-stone-900 tabular-nums">{value}</p>
        </div>
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-lg ${TONES[tone].tile}`}
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
      </div>
      <p className="relative mt-3 flex items-center gap-1 text-[11px] text-stone-500">
        {detail}
        {href ? <LuArrowUpRight className="h-3 w-3" aria-hidden /> : null}
      </p>
    </>
  );
  const className = "relative block overflow-hidden rounded-2xl border border-stone-200 bg-white p-5";
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** Daily series as an SVG area line; days without events count as zero. */
function Sparkline({ values }: { values: number[] }) {
  const width = 320;
  const height = 72;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => [index * step, height - 6 - (value / max) * (height - 14)] as const);
  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[72px] w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#d8b878" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#d8b878" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="spark-line" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#f0dcae" />
          <stop offset="100%" stopColor="#b18c4b" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-fill)" />
      <path d={line} fill="none" stroke="url(#spark-line)" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function lastDays(count: number, now = new Date()): string[] {
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() - (count - 1 - index));
    return day.toISOString().slice(0, 10);
  });
}

function timeAgo(date: Date): string {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString("en-BD", { day: "numeric", month: "short" });
}

const STATUS_STYLE: Record<string, string> = {
  bot: "bg-teal-50 text-teal-700 ring-teal-600/15",
  waiting_human: "bg-rose-50 text-rose-700 ring-rose-600/20",
  human: "bg-violet-50 text-violet-700 ring-violet-600/15",
  closed: "bg-stone-100 text-stone-500 ring-stone-500/10",
};

const STATUS_LABEL: Record<string, string> = {
  bot: "AI",
  waiting_human: "Needs human",
  human: "With team",
  closed: "Resolved",
};

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

  const [productCount, activeCount, knowledgeCount, conversationCount, waiting, preparedCheckouts, recent, sales, usage] =
    await Promise.all([
      prisma.product.count({ where: { storeId: store.id } }),
      prisma.product.count({ where: { storeId: store.id, status: "active" } }),
      prisma.knowledgeDocument.count({ where: { storeId: store.id, status: "ready" } }),
      prisma.conversation.count({ where: { storeId: store.id } }),
      prisma.conversation.count({ where: { storeId: store.id, status: "waiting_human" } }),
      prisma.checkoutSession.count({ where: { storeId: store.id, status: "prepared" } }),
      prisma.conversation.findMany({
        where: { storeId: store.id },
        orderBy: { updatedAt: "desc" },
        take: 6,
        include: {
          session: { select: { visitorId: true, locale: true } },
          _count: { select: { messages: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true } },
        },
      }),
      salesStats(store.id, 30),
      storeUsage(store.id, 30).catch(() => null),
    ]);

  const theme = parseJsonObject(store.settings?.widgetTheme);
  const accent = typeof theme.accent === "string" ? theme.accent : "#0f766e";
  const locales = parseJsonArray(store.supportedLocales);
  const ai = resolveAiStatus(store.settings);
  const voiceRate = sales.voiceSessions ? Math.round((sales.voiceOrders / sales.voiceSessions) * 100) : 0;

  const dayKeys = lastDays(30);
  const tokensByDay = new Map((usage?.days ?? []).map((day) => [day.date, day.totalTokens]));
  const series = dayKeys.map((day) => tokensByDay.get(day) ?? 0);
  const aiCost = usage ? usage.totals.costMicros / 1_000_000 : 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      <AdminBanner error={error} />

      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#151318] via-[#0f0f12] to-[#1b1710] p-6 text-white shadow-[0_40px_90px_-40px_rgba(0,0,0,0.9)] sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-[#d8b878]/[0.12] blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-[#b18c4b]/[0.10] blur-3xl" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(90deg,transparent,black)]"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-teal-100 backdrop-blur">
              <LuSparkles className="h-3 w-3" aria-hidden />
              {ai.config ? `Live AI · ${ai.model}` : "Demo responder"}
            </p>
            <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-tight sm:text-[32px]">
              {greeting}, here&apos;s {store.name}
            </h1>
            <p className="mt-1.5 text-[13px] text-stone-300">
              {locales.join(" / ") || "en"} · {store.currency} · last 30 days at a glance
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/inbox"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-white backdrop-blur transition hover:-translate-y-px hover:bg-white/20"
            >
              <LuInbox className="h-4 w-4" aria-hidden />
              Inbox
              {waiting > 0 ? <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-bold">{waiting}</span> : null}
            </Link>
            <Link
              href="/admin/products/new"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f3e1b8] via-[#d8b878] to-[#b18c4b] px-3.5 py-2.5 text-[12.5px] font-semibold text-[#191307] shadow-[0_14px_30px_-16px_rgba(0,0,0,0.9)] transition hover:-translate-y-px"
            >
              <LuPlus className="h-4 w-4" aria-hidden />
              Add product
            </Link>
          </div>
        </div>

        <div className="relative mt-7 grid gap-3 sm:grid-cols-3">
          {[
            { label: "Revenue", value: formatMinor(sales.revenueMinor, store.currency), icon: LuWallet },
            { label: "Orders", value: sales.orders.toLocaleString("en-US"), icon: LuShoppingBag },
            { label: "Conversations", value: conversationCount.toLocaleString("en-US"), icon: LuMessagesSquare },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-3.5 backdrop-blur-md">
              <p className="flex items-center gap-1.5 text-[11px] text-stone-300">
                <item.icon className="h-3.5 w-3.5" aria-hidden />
                {item.label}
              </p>
              <p className="mt-1 text-[22px] font-semibold tracking-tight tabular-nums">{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Key numbers */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Voice conversations"
          value={sales.voiceSessions}
          detail={`${sales.voiceOrders} orders · ${voiceRate}% converted`}
          icon={LuMic}
          tone="violet"
        />
        <StatCard
          label="Abandoned carts"
          value={sales.abandoned}
          detail="Idle 2h+ without ordering"
          icon={LuShoppingCart}
          tone="amber"
        />
        <StatCard
          label="Marketing opt-ins"
          value={sales.optIns}
          detail="New consents"
          icon={LuMailCheck}
          tone="emerald"
          href="/admin/customers?filter=opted_in"
        />
        <StatCard
          label="Waiting for a person"
          value={waiting}
          detail={waiting > 0 ? "Open the Inbox" : "All caught up"}
          icon={LuInbox}
          tone="rose"
          href="/admin/inbox?filter=attention"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        {/* Recent conversations */}
        <section className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold text-stone-900">Recent conversations</h2>
              <p className="mt-0.5 text-[11.5px] text-stone-500">Latest activity across chat and voice</p>
            </div>
            <Link
              href="/admin/inbox"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-medium text-teal-700 transition hover:bg-teal-50"
            >
              View all <LuArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>

          {recent.length === 0 ? (
            <div className="mt-5 flex flex-col items-center rounded-2xl border border-dashed border-stone-300/80 px-4 py-10 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-50 text-teal-600">
                <LuMessagesSquare className="h-5 w-5" aria-hidden />
              </span>
              <p className="mt-3 text-[12.5px] font-medium text-stone-700">No conversations yet</p>
              <p className="mt-0.5 text-[11.5px] text-stone-500">Open the storefront and start a chat.</p>
            </div>
          ) : (
            <ul className="mt-4 space-y-1">
              {recent.map((conversation) => {
                const who = conversation.customerName || `Visitor ${conversation.session.visitorId.slice(0, 6)}`;
                return (
                  <li key={conversation.id}>
                    <Link
                      href={`/admin/inbox/${conversation.id}`}
                      className="group flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition hover:bg-white hover:shadow-sm"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#d8b878]/20 bg-[#d8b878]/10 text-[12px] font-semibold text-[#f0dcae]">
                        {who.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-[12.5px] font-semibold text-stone-800">{who}</p>
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-semibold ring-1 ring-inset ${
                              STATUS_STYLE[conversation.status] ?? STATUS_STYLE.closed
                            }`}
                          >
                            {STATUS_LABEL[conversation.status] ?? conversation.status}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[11.5px] text-stone-500">
                          {conversation.messages[0]?.content || "No messages yet"}
                        </p>
                      </div>
                      <div className="hidden shrink-0 text-right sm:block">
                        <p className="text-[10.5px] text-stone-400">{timeAgo(conversation.updatedAt)}</p>
                        <p className="text-[10.5px] text-stone-400">{conversation._count.messages} msgs</p>
                      </div>
                      <LuArrowRight
                        className="h-3.5 w-3.5 shrink-0 text-stone-300 transition group-hover:translate-x-0.5 group-hover:text-teal-600"
                        aria-hidden
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          {/* AI usage */}
          <section className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-[14px] font-semibold text-stone-900">
                  <LuGauge className="h-4 w-4 text-teal-600" aria-hidden />
                  AI usage
                </h2>
                <p className="mt-0.5 text-[11.5px] text-stone-500">Tokens per day · last 30 days</p>
              </div>
              <Link href="/admin/ai-usage" className="text-[11.5px] font-medium text-teal-700 hover:text-teal-900">
                Details
              </Link>
            </div>
            <div className="mt-4 flex items-end gap-6">
              <div>
                <p className="text-[24px] font-semibold tracking-tight text-stone-900 tabular-nums">${aiCost.toFixed(2)}</p>
                <p className="text-[11px] text-stone-500">USD spent</p>
              </div>
              <div>
                <p className="text-[18px] font-semibold tracking-tight text-stone-800 tabular-nums">
                  {Intl.NumberFormat("en-US", { notation: "compact" }).format(usage?.totals.totalTokens ?? 0)}
                </p>
                <p className="text-[11px] text-stone-500">tokens</p>
              </div>
              {usage && usage.totals.unpricedEvents > 0 ? (
                <p className="ml-auto rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/15">
                  Some models unpriced
                </p>
              ) : null}
            </div>
            <div className="mt-3">
              <Sparkline values={series} />
            </div>
          </section>

          {/* Setup */}
          <section className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6">
            <h2 className="text-[14px] font-semibold text-stone-900">Assistant setup</h2>
            <dl className="mt-4 space-y-3 text-[12px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-stone-500">
                  <LuCpu className="h-3.5 w-3.5" aria-hidden /> AI mode
                </dt>
                <dd>
                  {ai.config ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/15">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live · {ai.model}
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/15">
                      Demo rules
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-stone-500">
                  <LuPackage className="h-3.5 w-3.5" aria-hidden /> Products
                </dt>
                <dd className="font-medium text-stone-700">
                  {activeCount} active <span className="text-stone-400">/ {productCount}</span>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-stone-500">
                  <LuBookOpen className="h-3.5 w-3.5" aria-hidden /> Knowledge
                </dt>
                <dd className="font-medium text-stone-700">{knowledgeCount} published</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-stone-500">
                  <LuShoppingCart className="h-3.5 w-3.5" aria-hidden /> Checkouts prepared
                </dt>
                <dd className="font-medium text-stone-700">{preparedCheckouts}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-stone-500">
                  <LuKey className="h-3.5 w-3.5" aria-hidden /> Widget key
                </dt>
                <dd className="rounded-md bg-stone-900/[0.04] px-2 py-0.5 font-mono text-[10.5px] text-stone-700">{store.widgetKey}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-stone-500">
                  <LuPalette className="h-3.5 w-3.5" aria-hidden /> Accent
                </dt>
                <dd className="flex items-center gap-1.5 font-mono text-[10.5px] text-stone-700">
                  <span className="inline-block h-3.5 w-3.5 rounded-full ring-2 ring-white shadow" style={{ backgroundColor: accent }} />
                  {accent}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="flex items-center gap-2 text-stone-500">
                  <LuExternalLink className="h-3.5 w-3.5" aria-hidden /> Checkout hosts
                </dt>
                <dd className="text-right text-[11px] text-stone-600">{allowedCheckoutHosts(store).join(", ")}</dd>
              </div>
            </dl>
            {!ai.config ? (
              <p className="mt-4 rounded-xl bg-amber-50/80 px-3 py-2.5 text-[11px] leading-relaxed text-amber-800 ring-1 ring-inset ring-amber-600/10">
                No AI model is connected, so the widget uses a demo responder over the real catalog.{" "}
                <Link href="/admin/ai" className="font-semibold underline underline-offset-2">
                  Connect a model
                </Link>
              </p>
            ) : null}
            <div className="mt-5 grid grid-cols-2 gap-2">
              {[
                { href: "/admin/chatbot", label: "Configure chatbot", icon: LuBot },
                { href: "/admin/knowledge", label: "Knowledge", icon: LuBookOpen },
              ].map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 px-3 py-2 text-[11.5px] font-semibold text-stone-700"
                >
                  <action.icon className="h-3.5 w-3.5" aria-hidden />
                  {action.label}
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
