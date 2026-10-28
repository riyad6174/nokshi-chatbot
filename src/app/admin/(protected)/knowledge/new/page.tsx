import Link from "next/link";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { KnowledgeForm } from "@/components/dashboard/KnowledgeForm";
import { createKnowledgeAction } from "@/app/admin/actions";
import { requireAdmin } from "@/lib/auth/admin";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

export default async function NewKnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { error } = await searchParams;
  const store = await getPrimaryStore();
  if (!store) return <AdminBanner error="No store configured. Run npm run db:seed." />;

  return (
    <div className="max-w-3xl">
      <AdminBanner error={error} />
      <Link href="/admin/knowledge" className="text-[11.5px] font-medium text-stone-500 hover:text-stone-800">
        ← Back to knowledge
      </Link>
      <h1 className="mt-2 font-serif text-2xl text-stone-900">New knowledge document</h1>
      <p className="mt-1 text-[12px] text-stone-500">
        Keep one topic per document. The assistant retrieves the best match and cites the title.
      </p>

      <div className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <KnowledgeForm action={createKnowledgeAction} submitLabel="Create document" />
      </div>
    </div>
  );
}
