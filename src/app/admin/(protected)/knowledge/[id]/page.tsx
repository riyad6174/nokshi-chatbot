import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { ConfirmSubmitButton } from "@/components/dashboard/ConfirmSubmitButton";
import { KnowledgeForm } from "@/components/dashboard/KnowledgeForm";
import { deleteKnowledgeAction, updateKnowledgeAction } from "@/app/admin/actions";
import {
  archiveKnowledgeAction,
  publishKnowledgeVersionAction,
  restoreKnowledgeAction,
} from "@/app/admin/knowledge-actions";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { listKnowledgeVersions } from "@/modules/knowledge/versions.service";
import { getAdminPageStore } from "@/modules/stores/admin-store";

export const dynamic = "force-dynamic";

export default async function KnowledgeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { saved, error } = await searchParams;
  const store = await getAdminPageStore();
  if (!store) return <AdminBanner error="No store configured." />;

  const document = await prisma.knowledgeDocument.findFirst({ where: { id, storeId: store.id } });
  if (!document) notFound();
  const versions = await listKnowledgeVersions(store.id, document.id);
  const savedMessage =
    saved === "published"
      ? "Version published. The assistant will use it on the next question."
      : saved === "restored"
        ? "Document restored and published."
        : "Document updated.";

  return (
    <div className="max-w-3xl">
      <AdminBanner error={error} saved={saved} savedMessage={savedMessage} />

      <Link href="/admin/knowledge" className="text-[11.5px] font-medium text-stone-500 hover:text-stone-800">
        ← Back to knowledge
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="font-serif text-2xl text-stone-900">{document.title}</h1>
          <p className="mt-1 text-[11px] text-stone-400">
            {document.status} · updated {new Date(document.updatedAt).toLocaleString()} · hash{" "}
            <span className="font-mono">{document.contentHash.slice(0, 12)}…</span>
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <KnowledgeForm
          action={updateKnowledgeAction}
          values={{
            id: document.id,
            title: document.title,
            content: document.content,
            sourceType: document.sourceType,
            sourceReference: document.sourceReference ?? "",
            status: document.status,
          }}
          submitLabel="Save document"
        />
      </div>

      <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[13px] font-semibold text-stone-900">Version history</h2>
            <p className="mt-1 text-[10.5px] text-stone-500">
              Publishing a draft snapshots it, clears cached answers, and refreshes retrieval embeddings.
            </p>
          </div>
          {document.status === "archived" ? (
            <form action={restoreKnowledgeAction}>
              <input type="hidden" name="documentId" value={document.id} />
              <button className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11.5px] font-semibold text-emerald-700 hover:bg-emerald-100">
                Restore &amp; publish
              </button>
            </form>
          ) : (
            <form action={archiveKnowledgeAction}>
              <input type="hidden" name="documentId" value={document.id} />
              <ConfirmSubmitButton
                confirmMessage={`Archive "${document.title}"? It will stop being searchable.`}
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-[11.5px] font-semibold text-stone-600 hover:bg-stone-50"
              >
                Archive
              </ConfirmSubmitButton>
            </form>
          )}
        </div>

        {versions.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-stone-300 px-3 py-4 text-center text-[11px] text-stone-500">
            No versions yet. Save this document to create the first snapshot.
          </p>
        ) : (
          <ol className="mt-4 space-y-2.5">
            {versions.map((version) => (
              <li key={version.id} className="rounded-lg border border-stone-200 px-3 py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[12px] font-semibold text-stone-800">
                      Version {version.version}
                      <span
                        className={`ml-2 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                          version.status === "published"
                            ? "bg-emerald-50 text-emerald-700"
                            : version.status === "archived"
                              ? "bg-stone-100 text-stone-500"
                              : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {version.status}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[10px] text-stone-500">
                      {new Date(version.createdAt).toLocaleString()} · {version.content.length} chars
                      {version.createdBy ? ` · ${version.createdBy}` : ""}
                    </p>
                  </div>
                  {version.status !== "published" ? (
                    <form action={publishKnowledgeVersionAction}>
                      <input type="hidden" name="documentId" value={document.id} />
                      <input type="hidden" name="versionId" value={version.id} />
                      <button className="rounded-lg bg-stone-900 px-2.5 py-1.5 text-[10.5px] font-semibold text-white hover:bg-stone-800">
                        Publish this version
                      </button>
                    </form>
                  ) : null}
                </div>
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[10.5px] font-medium text-stone-500 hover:text-stone-800">
                    Preview snapshot
                  </summary>
                  <div className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-50 p-2.5 text-[11px] leading-relaxed text-stone-700">
                    <p className="mb-1 font-semibold text-stone-900">{version.title}</p>
                    {version.content}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-5 rounded-xl border border-red-200 bg-white p-5">
        <h2 className="text-[13px] font-semibold text-red-700">Delete document</h2>
        <p className="mt-1 text-[10.5px] text-stone-500">
          The assistant will immediately stop retrieving this document.
        </p>
        <form action={deleteKnowledgeAction} className="mt-3">
          <input type="hidden" name="id" value={document.id} />
          <ConfirmSubmitButton
            confirmMessage={`Delete "${document.title}"? This cannot be undone.`}
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-[11.5px] font-semibold text-red-700 transition hover:bg-red-100"
          >
            Delete document
          </ConfirmSubmitButton>
        </form>
      </section>
    </div>
  );
}
