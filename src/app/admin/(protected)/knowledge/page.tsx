import Link from "next/link";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { listKnowledgeForAdmin } from "@/modules/knowledge/retrieval.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

export default async function AdminKnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const store = await getPrimaryStore();
  if (!store) return <AdminBanner error="No store configured. Run npm run db:seed." />;

  const documents = await listKnowledgeForAdmin(store.id);

  return (
    <div>
      <AdminBanner error={error} saved={saved} savedMessage="Knowledge base updated." />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-stone-900">Knowledge</h1>
          <p className="mt-1 text-[12px] text-stone-500">
            Approved policies and FAQs the assistant can retrieve. Only <span className="font-medium">ready</span>{" "}
            documents are searchable.
          </p>
        </div>
        <Link
          href="/admin/knowledge/new"
          className="rounded-lg bg-stone-900 px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-stone-800"
        >
          New document
        </Link>
      </div>

      <div className="mt-5 space-y-2.5">
        {documents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-[12px] text-stone-500">
            No knowledge documents yet.
          </div>
        ) : (
          documents.map((document) => (
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
                  <span
                    className={`rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide ${
                      document.status === "ready"
                        ? "bg-emerald-50 text-emerald-700"
                        : document.status === "failed"
                          ? "bg-red-50 text-red-600"
                          : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {document.status}
                  </span>
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[9.5px] text-stone-500">
                    {document.sourceType}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-stone-400">
                Updated {new Date(document.updatedAt).toLocaleString()} · hash{" "}
                <span className="font-mono">{document.contentHash.slice(0, 10)}…</span>
              </p>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
