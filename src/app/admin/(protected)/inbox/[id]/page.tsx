import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { AgentReplyBox } from "@/components/dashboard/AgentReplyBox";
import { AutoRefresh } from "@/components/dashboard/AutoRefresh";
import { ConversationScroll } from "@/components/dashboard/ConversationScroll";
import { ConversationStatusBadge } from "@/components/dashboard/ConversationStatusBadge";
import { ConversationTimeline, type TimelineSession } from "@/components/dashboard/inbox/ConversationTimeline";
import { formatCost, formatTokens } from "@/components/dashboard/inbox/format";
import { OBSERVABILITY_COOKIE } from "@/components/dashboard/inbox/observability-cookie";
import { ObservabilityPanel } from "@/components/dashboard/inbox/ObservabilityPanel";
import { ObservabilityToggle } from "@/components/dashboard/inbox/ObservabilityToggle";
import { closeAction, releaseAction, takeOverAction } from "@/app/admin/inbox-actions";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { formatMinor } from "@/lib/money";
import { getCartSummary } from "@/modules/cart/cart.service";
import { loadConversationObservability, loadConversationSessions } from "@/modules/analytics/conversation-observability";
import { getConversationUsage } from "@/modules/analytics/usage.service";
import { getConversationDetail, toChatMessage } from "@/modules/conversations/conversation.service";
import { markRead } from "@/modules/conversations/handoff.service";
import { STATUS_LABELS } from "@/modules/orders/order.service";
import { getAdminPageStore } from "@/modules/stores/admin-store";
import { parseJsonObject } from "@/modules/stores/store.service";
import { formatDateTime } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function InboxConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const admin = await requireAdmin();
  const { id } = await params;
  const { error } = await searchParams;
  const store = await getAdminPageStore();
  if (!store) notFound();
  const conversation = await getConversationDetail(store.id, id);
  if (!conversation) notFound();
  await markRead(store.id, conversation.id);

  // "Show token usage" is remembered per admin in this browser.
  const showUsage = (await cookies()).get(OBSERVABILITY_COOKIE)?.value === "1";
  const timelineInput = { storeId: store.id, sessionId: conversation.session.id, messages: conversation.messages };

  const [cart, orders, usage, gaps, observability, plainSessions] = await Promise.all([
    getCartSummary(conversation.session.id, store.id, store.currency),
    prisma.order.findMany({ where: { storeId: store.id, sessionId: conversation.session.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    showUsage ? null : getConversationUsage(store.id, conversation.id),
    // Questions from this chat the assistant couldn't answer: teach them in Knowledge.
    prisma.unansweredQuestion.findMany({
      where: { storeId: store.id, conversationId: conversation.id, status: { in: ["new", "reviewing"] } },
      orderBy: { lastAskedAt: "desc" },
      take: 5,
      select: { id: true, question: true, occurrences: true },
    }),
    showUsage ? loadConversationObservability({ ...timelineInput, conversationId: conversation.id }) : null,
    showUsage ? null : loadConversationSessions(timelineInput),
  ]);
  const sessions: TimelineSession[] =
    observability?.sessions ??
    (plainSessions ?? []).map((session, index) => ({
      index,
      kind: session.kind,
      start: new Date(session.start).toISOString(),
      end: new Date(session.end).toISOString(),
      durationMs: Math.max(0, session.end - session.start),
      messageIds: session.messageIds,
    }));
  const theme = parseJsonObject(store.settings?.widgetTheme);
  const accent = typeof theme.accent === "string" ? theme.accent : "#0f766e";
  const messages = conversation.messages.map(toChatMessage);
  const closed = conversation.status === "closed";
  const mine = conversation.status === "human" && conversation.assignedAdminId === admin.id;

  return (
    <div>
      <AutoRefresh intervalMs={3000} />
      <AdminBanner error={error} />
      <div className="flex items-center justify-between gap-2">
        <Link href="/admin/inbox" className="text-[11.5px] text-stone-500 hover:text-stone-800">
          ← Inbox
        </Link>
        <ObservabilityToggle on={showUsage} />
      </div>

      {observability ? (
        <div className="mt-2">
          <ObservabilityPanel data={observability} />
        </div>
      ) : null}

      <div className="mt-2 grid gap-4 lg:grid-cols-[1fr_260px]">
        <section className="flex h-[calc(100dvh-11rem)] min-h-[480px] flex-col overflow-hidden rounded-xl border border-stone-200 bg-white">
          <header className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-3">
            <p className="text-[13px] font-semibold text-stone-900">
              {conversation.customerName || `Visitor ${conversation.session.visitorId.slice(0, 6)}`}
            </p>
            <ConversationStatusBadge status={conversation.status} />
            {conversation.assignedName && conversation.status === "human" ? (
              <span className="text-[11px] text-stone-500">with {conversation.assignedName}</span>
            ) : null}
            <div className="ml-auto flex flex-wrap gap-1.5">
              {!closed && !mine ? (
                <form action={takeOverAction}>
                  <input type="hidden" name="conversationId" value={conversation.id} />
                  <button className="rounded-lg bg-stone-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-stone-800">
                    Take over
                  </button>
                </form>
              ) : null}
              {!closed && conversation.status !== "bot" ? (
                <form action={releaseAction}>
                  <input type="hidden" name="conversationId" value={conversation.id} />
                  <button className="rounded-lg border border-stone-300 px-3 py-1.5 text-[11px] font-semibold text-stone-700 hover:bg-stone-50">
                    Hand back to AI
                  </button>
                </form>
              ) : null}
              {!closed ? (
                <form action={closeAction}>
                  <input type="hidden" name="conversationId" value={conversation.id} />
                  <button className="rounded-lg border border-stone-300 px-3 py-1.5 text-[11px] font-semibold text-stone-700 hover:bg-stone-50">
                    Close
                  </button>
                </form>
              ) : null}
            </div>
          </header>

          {conversation.status === "waiting_human" && conversation.handoffReason ? (
            <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-[11.5px] text-red-800">
              Handed off: {conversation.handoffReason}
            </p>
          ) : null}

          {/* min-h-0: the list scrolls inside the panel instead of being squeezed out by the reply box. */}
          {/* admin-light: the conversation keeps the widget's light look, so cards appear exactly as the customer saw them. */}
          <ConversationScroll messageCount={messages.length} className="admin-light min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <p className="py-10 text-center text-[12px] text-stone-500">
                No messages in this chat yet. The customer opened the assistant but hasn&apos;t written anything.
              </p>
            ) : (
              <ConversationTimeline
                messages={messages}
                accent={accent}
                customer={{ name: conversation.customerName || null, visitorId: conversation.session.visitorId, phone: conversation.customerPhone || null }}
                sessions={sessions}
                observability={observability}
              />
            )}
          </ConversationScroll>

          <AgentReplyBox conversationId={conversation.id} disabled={closed} />
        </section>

        <aside className="space-y-3 text-[11.5px]">
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[12px] font-semibold text-stone-900">AI usage</h2>
              <Link href="/admin/ai-usage" className="text-[10px] text-stone-500 underline-offset-2 hover:underline">
                All usage
              </Link>
            </div>
            {observability ? (
              observability.totals.requests ? (
                <>
                  <p className="mt-1 text-[16px] font-semibold tabular-nums text-stone-900">
                    {observability.totals.unpriced === observability.totals.requests ? "No price set" : formatCost(observability.totals.costMicros)}
                  </p>
                  <p className="mt-0.5 text-stone-500">
                    {formatTokens(observability.totals.total)} tokens · {observability.totals.requests} request
                    {observability.totals.requests === 1 ? "" : "s"}
                  </p>
                  <ul className="mt-2 space-y-1 border-t border-stone-100 pt-2">
                    {observability.sessions.map((session) => (
                      <li key={session.index} className="flex justify-between gap-2 tabular-nums">
                        <a href={`#msg-${session.messageIds[0]}`} className="text-stone-600 hover:underline">
                          Session {session.index + 1}
                          {session.kind === "voice_call" ? " · 🎙" : ""}
                        </a>
                        <span className="text-right text-stone-700">
                          {formatCost(session.totals.costMicros)}
                          <span className="block text-[10px] text-stone-500">
                            {formatTokens(session.totals.total)} tok · {session.totals.requests} req
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {observability.totals.unpriced > 0 ? (
                    <p className="mt-1 text-[10.5px] text-amber-700">{observability.totals.unpriced} unpriced · add model pricing</p>
                  ) : null}
                </>
              ) : (
                <p className="mt-1 text-stone-500">No AI usage recorded</p>
              )
            ) : usage ? (
              <>
                <p className="mt-1 text-[16px] font-semibold tabular-nums text-stone-900">
                  ${(usage.costMicros / 1_000_000).toFixed(4)}
                </p>
                <p className="mt-0.5 text-stone-500">
                  {usage.totalTokens.toLocaleString("en-US")} tokens · {usage.eventCount} request
                  {usage.eventCount === 1 ? "" : "s"}
                </p>
                {usage.unpricedEventCount > 0 ? (
                  <p className="mt-1 text-[10.5px] text-amber-700">
                    {usage.unpricedEventCount} unpriced · add model pricing
                  </p>
                ) : null}
                <p className="mt-1 text-[10.5px] text-stone-500">Turn on “Show token usage” for every request.</p>
              </>
            ) : (
              <p className="mt-1 text-stone-500">No AI usage recorded</p>
            )}
          </div>
          {gaps.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[12px] font-semibold text-stone-900">Knowledge gaps</h2>
                <Link
                  href="/admin/knowledge?tab=questions"
                  className="text-[10px] text-stone-500 underline-offset-2 hover:underline"
                >
                  Teach
                </Link>
              </div>
              <ul className="mt-1.5 space-y-1 text-stone-700">
                {gaps.map((gap) => (
                  <li key={gap.id} className="break-words">
                    &ldquo;{gap.question}&rdquo;
                    {gap.occurrences > 1 ? (
                      <span className="ml-1 text-[10px] text-stone-500">asked {gap.occurrences}×</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="text-[12px] font-semibold text-stone-900">Cart</h2>
            {cart.items.length === 0 ? (
              <p className="mt-1 text-stone-500">Empty</p>
            ) : (
              <>
                <ul className="mt-1.5 space-y-1">
                  {cart.items.map((item) => (
                    <li key={item.itemId} className="flex justify-between gap-2">
                      <span className="text-stone-700">
                        {item.quantity}× {item.name}
                        {item.variantTitle ? ` (${item.variantTitle})` : ""}
                      </span>
                      <span className="shrink-0">{formatMinor(item.lineTotalMinor, cart.currency)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 border-t border-stone-100 pt-1.5 font-semibold">
                  Subtotal {formatMinor(cart.subtotalMinor, cart.currency)}
                </p>
              </>
            )}
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="text-[12px] font-semibold text-stone-900">Orders</h2>
            {orders.length === 0 ? (
              <p className="mt-1 text-stone-500">None from this chat</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {orders.map((order) => (
                  <li key={order.id}>
                    <Link href={`/admin/orders/${order.id}`} className="font-mono font-semibold underline-offset-2 hover:underline">
                      {order.orderNumber}
                    </Link>{" "}
                    <span className="text-stone-500">· {STATUS_LABELS[order.status]}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-4 text-stone-600">
            <p>Language: {conversation.session.locale}</p>
            <p>Started: {formatDateTime(conversation.createdAt)}</p>
            <p>Messages: {messages.length}</p>
            <p>Sessions: {sessions.length}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
