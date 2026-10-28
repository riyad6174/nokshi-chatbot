import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { AgentReplyBox } from "@/components/dashboard/AgentReplyBox";
import { AutoRefresh } from "@/components/dashboard/AutoRefresh";
import { ConversationStatusBadge } from "@/components/dashboard/ConversationStatusBadge";
import { closeAction, releaseAction, takeOverAction } from "@/app/admin/inbox-actions";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { formatMinor } from "@/lib/money";
import { getCartSummary } from "@/modules/cart/cart.service";
import { getConversationDetail, toChatMessage } from "@/modules/conversations/conversation.service";
import { markRead } from "@/modules/conversations/handoff.service";
import { STATUS_LABELS } from "@/modules/orders/order.service";
import { getPrimaryStore } from "@/modules/stores/store.service";
import type { ChatMessage, ChatPart } from "@/types/chat";

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
          {new Date(message.createdAt).toLocaleTimeString("en-BD", { hour: "2-digit", minute: "2-digit" })}
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
  const store = await getPrimaryStore();
  if (!store) notFound();
  const conversation = await getConversationDetail(store.id, id);
  if (!conversation) notFound();
  await markRead(store.id, conversation.id);

  const [cart, orders] = await Promise.all([
    getCartSummary(conversation.session.id, store.id, store.currency),
    prisma.order.findMany({ where: { storeId: store.id, sessionId: conversation.session.id }, orderBy: { createdAt: "desc" }, take: 5 }),
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

          <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
            {messages.map((message) => (
              <Bubble key={message.id} message={message} />
            ))}
          </div>

          <AgentReplyBox conversationId={conversation.id} disabled={closed} />
        </section>

        <aside className="space-y-3 text-[11.5px]">
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
            <p>Started: {conversation.createdAt.toLocaleString("en-BD")}</p>
            <p>Messages: {messages.length}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
