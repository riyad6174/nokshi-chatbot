import Link from "next/link";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { AutoRefresh } from "@/components/dashboard/AutoRefresh";
import { ConversationStatusBadge } from "@/components/dashboard/ConversationStatusBadge";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import {
  countInboxFilters,
  listConversations,
  parseInboxFilter,
  type InboxFilter,
} from "@/modules/conversations/conversation.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

const FILTERS: Array<{ id: InboxFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs human" },
  { id: "unread", label: "Unread" },
  { id: "bot", label: "AI handling" },
  { id: "closed", label: "Resolved" },
];

function ago(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return date.toLocaleDateString("en-BD");
}

const PAGE_SIZE = 25;

function inboxHref(filter: InboxFilter, page = 1): string {
  return `/admin/inbox?filter=${filter}${page > 1 ? `&page=${page}` : ""}`;
}

/** Page numbers to show: the first, the last, and two either side of the current one, with gaps. */
function pageNumbers(current: number, total: number): Array<number | "gap"> {
  const pages: Array<number | "gap"> = [];
  for (let page = 1; page <= total; page += 1) {
    if (page === 1 || page === total || Math.abs(page - current) <= 2) pages.push(page);
    else if (pages.at(-1) !== "gap") pages.push("gap");
  }
  return pages;
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  await requireAdmin();
  const { filter: rawFilter, page: rawPage } = await searchParams;
  const store = await getPrimaryStore();
  if (!store) return <AdminBanner error="No store configured. Run npm run db:seed." />;

  // Always opens on every chat; the red badge and the "Needs human" tab surface the waiting ones.
  const filter = parseInboxFilter(rawFilter);
  const [waiting, counts] = await Promise.all([
    prisma.conversation.count({ where: { storeId: store.id, status: "waiting_human" } }),
    countInboxFilters(store.id),
  ]);
  const total = counts[filter];
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // A page past the end (e.g. chats were resolved meanwhile) shows the last page instead of nothing.
  const page = Math.min(Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1), pageCount);
  const conversations = await listConversations(store.id, filter, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

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
          <Link
            href="/admin/inbox?filter=attention"
            className="flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-[11.5px] font-semibold text-red-700 hover:bg-red-100"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-red-400" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            {waiting} waiting for a person
          </Link>
        ) : null}
      </div>

      <nav aria-label="Filter conversations" className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((entry) => (
          <Link
            key={entry.id}
            href={inboxHref(entry.id)}
            aria-current={filter === entry.id ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
              filter === entry.id ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:ring-stone-300"
            }`}
          >
            {entry.label}
            <span
              className={`rounded-full px-1.5 py-px text-[9.5px] ${
                filter === entry.id
                  ? "bg-white/15 text-white"
                  : entry.id === "attention" && counts.attention > 0
                    ? "bg-red-100 text-red-700"
                    : "bg-stone-100 text-stone-500"
              }`}
            >
              {counts[entry.id]}
            </span>
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

      {total > 0 ? (
        <nav aria-label="Inbox pages" className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11.5px] text-stone-500">
            Showing {from}–{to} of {total}
          </p>
          {pageCount > 1 ? (
            <div className="flex flex-wrap items-center gap-1">
              <PageLink href={inboxHref(filter, page - 1)} disabled={page === 1} label="Previous page">
                ‹ Prev
              </PageLink>
              {pageNumbers(page, pageCount).map((entry, index) =>
                entry === "gap" ? (
                  <span key={`gap-${index}`} className="px-1 text-[11.5px] text-stone-400">
                    …
                  </span>
                ) : (
                  <PageLink key={entry} href={inboxHref(filter, entry)} current={entry === page} label={`Page ${entry}`}>
                    {entry}
                  </PageLink>
                ),
              )}
              <PageLink href={inboxHref(filter, page + 1)} disabled={page === pageCount} label="Next page">
                Next ›
              </PageLink>
            </div>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

function PageLink({
  href,
  children,
  label,
  current = false,
  disabled = false,
}: {
  href: string;
  children: React.ReactNode;
  label: string;
  current?: boolean;
  disabled?: boolean;
}) {
  const base = "min-w-[30px] rounded-lg px-2.5 py-1 text-center text-[11.5px] font-medium";
  if (disabled) {
    return (
      <span aria-disabled className={`${base} cursor-not-allowed text-stone-400 opacity-50`}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      className={`${base} transition ${
        current ? "bg-stone-900 text-white" : "border border-stone-300 text-stone-700 hover:text-stone-900"
      }`}
    >
      {children}
    </Link>
  );
}
