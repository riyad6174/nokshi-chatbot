import Image from "next/image";
import Link from "next/link";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { formatMinor } from "@/lib/money";
import { listProductsForAdmin } from "@/modules/catalog/product.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const store = await getPrimaryStore();

  if (!store) {
    return <AdminBanner error="No store configured. Run npm run db:seed." />;
  }

  const products = await listProductsForAdmin(store.id);

  return (
    <div>
      <AdminBanner error={error} saved={saved} savedMessage="Product catalog updated." />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-stone-900">Products</h1>
          <p className="mt-1 text-[12px] text-stone-500">
            {products.length} total · only active products are visible to the assistant and storefront.
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="rounded-lg bg-stone-900 px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-stone-800"
        >
          New product
        </Link>
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-stone-200 bg-white">
        {products.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-[12.5px] text-stone-600">No products yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-[10px] uppercase tracking-[0.12em] text-stone-400">
                  <th className="px-4 py-2.5 font-semibold">Product</th>
                  <th className="px-4 py-2.5 font-semibold">Category</th>
                  <th className="px-4 py-2.5 font-semibold">Price</th>
                  <th className="px-4 py-2.5 font-semibold">Variants</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {products.map((product) => {
                  const outOfStock = product.variants.every(
                    (variant) =>
                      variant.stockStatus === "out_of_stock" ||
                      (variant.stockQuantity != null && variant.stockQuantity <= 0),
                  );
                  return (
                    <tr key={product.id} className="text-[12px] text-stone-700">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-stone-100">
                            {product.imageUrl ? (
                              <Image
                                src={product.imageUrl}
                                alt=""
                                fill
                                unoptimized
                                sizes="36px"
                                className="object-cover"
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-stone-900">{product.name}</p>
                            <p className="truncate text-[10.5px] text-stone-400">/{product.slug}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">{product.category}</td>
                      <td className="px-4 py-2.5 font-medium text-stone-900">
                        {formatMinor(product.priceMinor, product.currency, "en-BD")}
                      </td>
                      <td className="px-4 py-2.5">
                        {product.variants.length}
                        {outOfStock && product.variants.length > 0 ? (
                          <span className="ml-1.5 text-[10px] text-amber-600">all sold out</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            product.status === "active"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-stone-100 text-stone-500"
                          }`}
                        >
                          {product.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/admin/products/${product.id}`}
                          className="text-[11px] font-semibold text-stone-600 underline-offset-2 hover:text-stone-900 hover:underline"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
