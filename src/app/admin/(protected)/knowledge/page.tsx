import Link from "next/link";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import {
  ignoreQuestionAction,
  linkQuestionKnowledgeAction,
  resolveQuestionAction,
  restoreKnowledgeAction,
  reviewQuestionAction,
  saveKnowledgeSettingsAction,
} from "@/app/admin/knowledge-actions";
import { prisma } from "@/lib/db/prisma";
import { listUnansweredQuestions } from "@/modules/knowledge/learning.service";
import { listKnowledgeForAdmin } from "@/modules/knowledge/retrieval.service";
import { getAdminPageStore } from "@/modules/stores/admin-store";
import { formatDateTime } from "@/lib/dates";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "questions", label: "Questions to teach" },
  { id: "drafts", label: "Drafts" },
  { id: "published", label: "Published" },
  { id: "review", label: "Needs review" },
  { id: "archived", label: "Archived" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function statusClass(status: string): string {
  if (status === "ready" || status === "published") return "bg-emerald-50 text-emerald-700";
  if (status === "archived") return "bg-stone-100 text-stone-500";
  if (status === "failed") return "bg-red-50 text-red-600";
  return "bg-amber-50 text-amber-700";
}

export default async function AdminKnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; saved?: string; error?: string }>;
}) {
  const { tab: rawTab, saved, error } = await searchParams;
  const store = await getAdminPageStore();
  if (!store) return <AdminBanner error="No store configured. Run npm run db:seed." />;
  const tab: TabId = TABS.some((entry) => entry.id === rawTab) ? (rawTab as TabId) : "published";

  const [documents, unanswered, draftCount, publishedCount, archivedCount] = await Promise.all([
    listKnowledgeForAdmin(store.id),
    listUnansweredQuestions(store.id, { statuses: ["new", "reviewing"], take: 200 }),
    prisma.knowledgeDocument.count({ where: { storeId: store.id, status: { notIn: ["ready", "archived"] } } }),
    prisma.knowledgeDocument.count({ where: { storeId: store.id, status: "ready" } }),
    prisma.knowledgeDocument.count({ where: { storeId: store.id, status: "archived" } }),
  ]);

  const needsReview = unanswered.filter((question) => question.occurrences >= 2);
  const visibleQuestions = tab === "review" ? needsReview : unanswered;
  const visibleDocuments =
    tab === "drafts"
      ? documents.filter((document) => document.status !== "ready" && document.status !== "archived")
      : tab === "archived"
        ? documents.filter((document) => document.status === "archived")
        : documents.filter((document) => document.status === "ready");
  const readyDocuments = documents.filter((document) => document.status === "ready");
  const counts: Record<TabId, number> = {
    questions: unanswered.length,
    drafts: draftCount,
    published: publishedCount,
    review: needsReview.length,
    archived: archivedCount,
  };

  return (
    <div>
      <AdminBanner error={error} saved={saved} savedMessage="Knowledge base updated." />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-stone-900">Knowledge</h1>
          <p className="mt-1 text-[12px] text-stone-500">
            Teach the assistant from real questions, review drafts, and publish only approved answers.
            Published documents are the ones the assistant can retrieve.
          </p>
        </div>
        <Link
          href="/admin/knowledge/new"
          className="rounded-lg bg-stone-900 px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-stone-800"
        >
          New document
        </Link>
      </div>

      <form
        action={saveKnowledgeSettingsAction}
        className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-stone-200 bg-white px-3 py-2"
      >
        <input type="hidden" name="tab" value={tab} />
        <label className="flex items-center gap-2 text-[11.5px] text-stone-700">
          <input type="checkbox" name="knowledgeLearningEnabled" defaultChecked={store.settings?.knowledgeLearningEnabled !== false} />
          Collect questions the assistant couldn&apos;t answer
        </label>
        <label className="flex items-center gap-2 text-[11.5px] text-stone-700">
          <input type="checkbox" name="answerCacheEnabled" defaultChecked={store.settings?.answerCacheEnabled === true} />
          Reuse answers to repeated FAQ questions (published knowledge only)
        </label>
        <button
          type="submit"
          className="ml-auto rounded-md border border-stone-300 px-2.5 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-50"
        >
          Save
        </button>
      </form>

      <nav aria-label="Knowledge sections" className="mt-5 flex flex-wrap gap-1 border-b border-stone-200 pb-2">
        {TABS.map((entry) => (
          <Link
            key={entry.id}
            href={`/admin/knowledge?tab=${entry.id}`}
            aria-current={tab === entry.id ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium ${
              tab === entry.id ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            }`}
          >
            {entry.label}
            {counts[entry.id] > 0 ? (
              <span
                className={`rounded-full px-1.5 py-px text-[9.5px] ${
                  tab === entry.id ? "bg-white/15 text-white" : "bg-stone-200 text-stone-600"
                }`}
              >
                {counts[entry.id]}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>

      {tab === "questions" || tab === "review" ? (
        <div className="mt-5 space-y-2.5">
          {visibleQuestions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-[12px] text-stone-500">
              {tab === "review" ? "No repeated questions need review." : "No unanswered questions right now."}
            </div>
          ) : (
            visibleQuestions.map((question) => (
              <article key={question.id} className="rounded-xl border border-stone-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold leading-snug text-stone-900">{question.question}</p>
                    <p className="mt-1 text-[10.5px] text-stone-500">
                      {question.occurrences}× asked · {question.channel} · {question.language || "unknown language"} ·{" "}
                      {question.outcome} · last{" "}
                      {new Date(question.lastAskedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                    {question.reason ? (
                      <p className="mt-0.5 text-[10px] text-stone-400">Reason: {question.reason}</p>
                    ) : null}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide ${statusClass(question.status)}`}>
                    {question.status}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Link
                    href={`/admin/knowledge/new?questionId=${question.id}`}
                    className="rounded-lg bg-stone-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-stone-800"
                  >
                    Write answer
                  </Link>
                  {readyDocuments.length > 0 ? (
                    <form action={linkQuestionKnowledgeAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="questionId" value={question.id} />
                      <select
                        name="knowledgeId"
                        required
                        defaultValue=""
                        className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-[11px] text-stone-700"
                      >
                        <option value="" disabled>
                          Link existing…
                        </option>
                        {readyDocuments.map((document) => (
                          <option key={document.id} value={document.id}>
                            {document.title}
                          </option>
                        ))}
                      </select>
                      <button className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 hover:bg-stone-50">
                        Link
                      </button>
                    </form>
                  ) : null}
                  <form action={reviewQuestionAction}>
                    <input type="hidden" name="questionId" value={question.id} />
                    <button className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 hover:bg-stone-50">
                      Review
                    </button>
                  </form>
                  <form action={resolveQuestionAction}>
                    <input type="hidden" name="questionId" value={question.id} />
                    <button className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 hover:bg-stone-50">
                      Mark answered
                    </button>
                  </form>
                  <form action={ignoreQuestionAction}>
                    <input type="hidden" name="questionId" value={question.id} />
                    <button className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-stone-400 hover:text-stone-700">
                      Ignore
                    </button>
                  </form>
                </div>
              </article>
            ))
          )}
        </div>
      ) : (
        <div className="mt-5 space-y-2.5">
          {visibleDocuments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-[12px] text-stone-500">
              {tab === "drafts"
                ? "No drafts. Saving a document as Pending keeps it out of the assistant until it is published."
                : tab === "archived"
                  ? "Nothing archived."
                  : "No published documents yet."}
            </div>
          ) : (
            visibleDocuments.map((document) => (
              <article
                key={document.id}
                className="rounded-xl border border-stone-200 bg-white p-4 transition hover:border-stone-300"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/knowledge/${document.id}`}
                      className="text-[13px] font-semibold text-stone-900 hover:underline"
                    >
                      {document.title}
                    </Link>
                    <p className="mt-1 line-clamp-2 max-w-2xl text-[11.5px] leading-relaxed text-stone-500">
                      {document.content}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide ${statusClass(document.status)}`}>
                      {document.status}
                    </span>
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[9.5px] text-stone-500">
                      {document.sourceType}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] text-stone-400">
                    Updated {formatDateTime(document.updatedAt)} · hash{" "}
                    <span className="font-mono">{document.contentHash.slice(0, 10)}…</span>
                  </p>
                  {tab === "archived" ? (
                    <form action={restoreKnowledgeAction}>
                      <input type="hidden" name="documentId" value={document.id} />
                      <button className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 hover:bg-stone-50">
                        Restore &amp; publish
                      </button>
                    </form>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>
      )}
    </div>
  );
}
