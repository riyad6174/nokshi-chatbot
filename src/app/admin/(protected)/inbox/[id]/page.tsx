import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { AgentReplyBox } from "@/components/dashboard/AgentReplyBox";
import { AutoRefresh } from "@/components/dashboard/AutoRefresh";
import { ConversationScroll } from "@/components/dashboard/ConversationScroll";
import { ConversationStatusBadge } from "@/components/dashboard/ConversationStatusBadge";
import { closeAction, releaseAction, takeOverAction } from "@/app/admin/inbox-actions";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { formatMinor } from "@/lib/money";
import { getCartSummary } from "@/modules/cart/cart.service";
import { getConversationUsage } from "@/modules/analytics/usage.service";
import { getConversationDetail, toChatMessage } from "@/modules/conversations/conversation.service";
import { markRead } from "@/modules/conversations/handoff.service";
import { conversationDigest } from "@/modules/conversations/summary.service";
import { STATUS_LABELS } from "@/modules/orders/order.service";
import { getAdminPageStore } from "@/modules/stores/admin-store";
import type { ChatMessage, ChatPart } from "@/types/chat";
import { formatDateTime, formatMessageTime } from "@/lib/dates";

export const dynamic = "force-dynamic";

function describePart(part: ChatPart): string | null {
  switch (part.type) {
    case "product_list":
      return `Showed products: ${part.products.map((product) => product.name).join(", ")}`;
    case "cart_summary":
      return `Cart: ${part.cart.items.map((item) => `${item.quantity}× ${item.name}`).join(", ") || "empty"} (${formatMinor(part.cart.subtotalMinor, part.cart.currency)})`;
    case "checkout_action":
      return "Offered the checkout button";
    case "details_form":
      return "Asked for delivery details";
    case "refine_options":
      return `Offered filters: ${part.options.facets.map((facet) => `${facet.name} (${facet.values.join(", ")})`).join("; ")}`;
    case "order_status":
      return part.orders.map((order) => `Order ${order.orderNumber}: ${order.statusLabel}`).join("; ");
    case "contact_form":
      return "Asked the customer to check their contact details";
    case "order_confirmation":
      return `Order summary to confirm (cash on delivery): ${formatMinor(part.confirmation.totalMinor, part.confirmation.currency)} to ${part.confirmation.customer.name}, ${part.confirmation.customer.phone}`;
    case "comparison":
      return `Compared: ${part.products.map((product) => product.name).join(" vs ")}`;
    case "suggestion_actions":
      return "(Proactive suggestion)";
    default:
      return null;
  }
}

function Bubble({ message }: { message: ChatMessage }) {
  if (message.role === "event") {
    const text = message.parts.find((part) => part.type === "text");
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-full bg-stone-100 px-3 py-1 text-[10.5px] text-stone-500">
          {text && text.type === "text" ? text.text : "Event"}
        </span>
      </div>
    );
  }
  const mine = message.role === "agent";
  const customer = message.role === "user";
  return (
    <div className={`flex ${customer ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed ${
          customer ? "bg-stone-100 text-stone-900" : mine ? "bg-stone-900 text-white" : "bg-emerald-50 text-emerald-950"
        }`}
      >
        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-60">
          {customer ? "Customer" : mine ? message.senderName || "Agent" : "AI assistant"} ·{" "}
          <time dateTime={new Date(message.createdAt).toISOString()} title={formatDateTime(message.createdAt)}>
            {formatMessageTime(message.createdAt)}
          </time>
        </p>
        {message.parts.map((part, index) =>
          part.type === "text" ? (
            <p key={index} className="whitespace-pre-line">
              {part.text}
            </p>
          ) : describePart(part) ? (
            <p key={index} className="mt-1 text-[11px] italic opacity-75">
              {describePart(part)}
            </p>
          ) : null,
        )}
        {message.attachments?.map((attachment) => (
          <div key={attachment.uploadId} className="mt-1.5">
            {attachment.kind === "image" ? (
              <a href={attachment.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attachment.url} alt={attachment.name} className="max-h-48 rounded-lg" />
              </a>
            ) : attachment.kind === "audio" ? (
              <div>
                <audio controls src={attachment.url} className="h-9 max-w-full" />
                <p className="mt-0.5 text-[11px] opacity-75">
                  {attachment.transcript ? `Transcript: “${attachment.transcript}”` : "No transcript (browser couldn't recognize the speech)."}
                </p>
              </div>
            ) : (
              <a href={attachment.url} className="underline underline-offset-2">
                📎 {attachment.name}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

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

  const [cart, orders, digest, usage, gaps] = await Promise.all([
    getCartSummary(conversation.session.id, store.id, store.currency),
    prisma.order.findMany({ where: { storeId: store.id, sessionId: conversation.session.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    // Lets an agent catch up quickly after a handoff.
    conversationDigest(conversation.id).catch(() => ""),
    getConversationUsage(store.id, conversation.id),
    // Questions from this chat the assistant couldn't answer: teach them in Knowledge.
    prisma.unansweredQuestion.findMany({
      where: { storeId: store.id, conversationId: conversation.id, status: { in: ["new", "reviewing"] } },
      orderBy: { lastAskedAt: "desc" },
      take: 5,
      select: { id: true, question: true, occurrences: true },
    }),
  ]);
  const messages = conversation.messages.map(toChatMessage);
  const closed = conversation.status === "closed";
  const mine = conversation.status === "human" && conversation.assignedAdminId === admin.id;

  return (
    <div>
      <AutoRefresh intervalMs={3000} />
      <AdminBanner error={error} />
      <Link href="/admin/inbox" className="text-[11.5px] text-stone-500 hover:text-stone-800">
        ← Inbox
      </Link>

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
          <ConversationScroll messageCount={messages.length} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <p className="py-10 text-center text-[12px] text-stone-500">
                No messages in this chat yet. The customer opened the assistant but hasn&apos;t written anything.
              </p>
            ) : (
              messages.map((message) => <Bubble key={message.id} message={message} />)
            )}
          </ConversationScroll>

          <AgentReplyBox conversationId={conversation.id} disabled={closed} />
        </section>

        <aside className="space-y-3 text-[11.5px]">
          {digest ? (
            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <h2 className="text-[12px] font-semibold text-stone-900">Summary</h2>
              <ul className="mt-1 space-y-1 text-stone-600">
                {digest.split("\n").map((line) => (
                  <li key={line}>{line.replace(/^- /, "")}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[12px] font-semibold text-stone-900">AI usage</h2>
              <Link href="/admin/ai-usage" className="text-[10px] text-stone-500 underline-offset-2 hover:underline">
                Details
              </Link>
            </div>
            {usage ? (
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
          </div>
        </aside>
      </div>
    </div>
  );
}
