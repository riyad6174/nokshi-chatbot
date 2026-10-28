import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { ConfirmSubmitButton } from "@/components/dashboard/ConfirmSubmitButton";
import { KnowledgeForm } from "@/components/dashboard/KnowledgeForm";
import { deleteKnowledgeAction, updateKnowledgeAction } from "@/app/admin/actions";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { getPrimaryStore } from "@/modules/stores/store.service";

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
  const store = await getPrimaryStore();
  if (!store) return <AdminBanner error="No store configured." />;

  const document = await prisma.knowledgeDocument.findFirst({ where: { id, storeId: store.id } });
  if (!document) notFound();

  return (
    <div className="max-w-3xl">
      <AdminBanner error={error} saved={saved} savedMessage="Document updated." />

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
