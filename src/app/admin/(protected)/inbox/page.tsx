import Link from "next/link";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { AutoRefresh } from "@/components/dashboard/AutoRefresh";
import { ConversationStatusBadge } from "@/components/dashboard/ConversationStatusBadge";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { listConversations, type InboxFilter } from "@/modules/conversations/conversation.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

const FILTERS: Array<{ id: InboxFilter; label: string }> = [
  { id: "attention", label: "Needs a person" },
  { id: "human", label: "Handled by team" },
  { id: "bot", label: "AI" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

function ago(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return date.toLocaleDateString("en-BD");
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireAdmin();
  const { filter: rawFilter } = await searchParams;
  const store = await getPrimaryStore();
  if (!store) return <AdminBanner error="No store configured. Run npm run db:seed." />;

  const waiting = await prisma.conversation.count({ where: { storeId: store.id, status: "waiting_human" } });
  const filter = (FILTERS.some((entry) => entry.id === rawFilter) ? rawFilter : waiting > 0 ? "attention" : "all") as InboxFilter;
  const conversations = await listConversations(store.id, filter, 80);

  return (
    <div>
      <AutoRefresh intervalMs={5000} />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-serif text-2xl text-stone-900">Inbox</h1>
          <p className="mt-1 text-[12px] text-stone-500">
            Chats the assistant handed to your team, plus every conversation. Updates live.
          </p>
        </div>
        {waiting > 0 ? (
          <span className="flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-[11.5px] font-semibold text-red-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-red-400" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            {waiting} waiting for a person
          </span>
        ) : null}
      </div>

      <nav aria-label="Filter conversations" className="mt-4 flex flex-wrap gap-1.5">
        {FILTERS.map((entry) => (
          <Link
            key={entry.id}
            href={`/admin/inbox?filter=${entry.id}`}
            aria-current={filter === entry.id ? "page" : undefined}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
              filter === entry.id ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:ring-stone-300"
            }`}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      <ul className="mt-4 divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
        {conversations.length === 0 ? (
          <li className="p-6 text-center text-[12px] text-stone-500">Nothing here right now.</li>
        ) : (
          conversations.map((conversation) => {
            const last = conversation.messages[0];
            const who = conversation.customerName || `Visitor ${conversation.session.visitorId.slice(0, 6)}`;
            return (
              <li key={conversation.id}>
                <Link
                  href={`/admin/inbox/${conversation.id}`}
                  className={`flex items-start gap-3 px-4 py-3 transition hover:bg-stone-50 ${
                    conversation.status === "waiting_human" ? "bg-red-50/40" : ""
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stone-100 text-[12px] font-semibold text-stone-600">
                    {who.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[12.5px] font-semibold text-stone-900">{who}</p>
                      <ConversationStatusBadge status={conversation.status} />
                      {conversation.unreadForAdmin > 0 ? (
                        <span className="rounded-full bg-stone-900 px-1.5 py-px text-[10px] font-semibold text-white">
                          {conversation.unreadForAdmin}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-[11.5px] text-stone-500">
                      {conversation.status === "waiting_human" && conversation.handoffReason
                        ? `⚑ ${conversation.handoffReason}`
                        : last
                          ? `${last.role === "user" ? "" : last.role === "agent" ? "You: " : "AI: "}${last.content || "(attachment)"}`
                          : "No messages yet"}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10.5px] text-stone-400">{ago(conversation.lastMessageAt)}</span>
                </Link>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
