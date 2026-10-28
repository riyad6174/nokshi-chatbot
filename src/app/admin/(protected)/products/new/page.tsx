import Link from "next/link";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { ProductForm } from "@/components/dashboard/ProductForm";
import { createProductAction } from "@/app/admin/actions";
import { requireAdmin } from "@/lib/auth/admin";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

export default async function NewProductPage({
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
      <Link href="/admin/products" className="text-[11.5px] font-medium text-stone-500 hover:text-stone-800">
        ← Back to products
      </Link>
      <h1 className="mt-2 font-serif text-2xl text-stone-900">New product</h1>
      <p className="mt-1 text-[12px] text-stone-500">
        The assistant can only recommend active products in this store. Add variants after saving.
      </p>

      <div className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <ProductForm
          action={createProductAction}
          currency={store.currency}
          submitLabel="Create product"
          cancelHref="/admin/products"
        />
      </div>
    </div>
  );
}
