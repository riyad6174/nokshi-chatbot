import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { ConfirmSubmitButton } from "@/components/dashboard/ConfirmSubmitButton";
import { ProductForm } from "@/components/dashboard/ProductForm";
import {
  createVariantAction,
  deleteProductAction,
  deleteVariantAction,
  updateProductAction,
  updateVariantStockAction,
} from "@/app/admin/actions";
import { requireAdmin } from "@/lib/auth/admin";
import { formatMinor } from "@/lib/money";
import { getProductForAdmin, parseOptions } from "@/modules/catalog/product.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[12px] text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none";

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; created?: string; error?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { saved, created, error } = await searchParams;
  const store = await getPrimaryStore();
  if (!store) return <AdminBanner error="No store configured." />;

  const product = await getProductForAdmin(store.id, id);
  if (!product) notFound();

  return (
    <div className="max-w-4xl">
      <AdminBanner
        error={error}
        saved={saved || created}
        savedMessage={created ? "Product created. Add variants below." : "Product updated."}
      />

      <Link href="/admin/products" className="text-[11.5px] font-medium text-stone-500 hover:text-stone-800">
        ← Back to products
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-stone-900">{product.name}</h1>
          <p className="mt-1 text-[11.5px] text-stone-500">
            /{product.slug} · {product.category} ·{" "}
            {formatMinor(product.priceMinor, product.currency, "en-BD")}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
            product.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-500"
          }`}
        >
          {product.status}
        </span>
      </div>

      <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-[13px] font-semibold text-stone-900">Product details</h2>
        <div className="mt-4">
          <ProductForm
            action={updateProductAction}
            values={{
              id: product.id,
              name: product.name,
              slug: product.slug,
              description: product.description,
              category: product.category,
              price: product.priceMinor / 100,
              imageUrl: product.imageUrl ?? "",
              externalProductId: product.externalProductId ?? "",
              status: product.status,
            }}
            currency={store.currency}
            submitLabel="Save product"
            cancelHref="/admin/products"
          />
        </div>
      </section>

      <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[13px] font-semibold text-stone-900">Variants</h2>
            <p className="mt-0.5 text-[10.5px] text-stone-400">
              Every purchasable option needs a SKU. Add a default variant even for single-option products.
            </p>
          </div>
          <span className="text-[11px] text-stone-400">{product.variants.length} total</span>
        </div>

        {product.variants.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left">
              <thead>
                <tr className="border-y border-stone-200 bg-stone-50 text-[9.5px] uppercase tracking-[0.12em] text-stone-400">
                  <th className="px-2 py-2 font-semibold">Variant</th>
                  <th className="px-2 py-2 font-semibold">SKU</th>
                  <th className="px-2 py-2 font-semibold">Price</th>
                  <th className="px-2 py-2 font-semibold">Stock</th>
                  <th className="px-2 py-2 text-right font-semibold">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {product.variants.map((variant) => {
                  const options = parseOptions(variant.options);
                  return (
                    <tr key={variant.id} className="text-[11.5px] text-stone-700">
                      <td className="px-2 py-2.5">
                        <p className="font-medium text-stone-900">{variant.title}</p>
                        <p className="text-[10px] text-stone-400">
                          {Object.entries(options)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(" · ") || "no options"}
                        </p>
                      </td>
                      <td className="px-2 py-2.5 font-mono text-[10.5px]">{variant.sku}</td>
                      <td className="px-2 py-2.5">
                        {formatMinor(
                          variant.priceOverrideMinor ?? product.priceMinor,
                          product.currency,
                          "en-BD",
                        )}
                      </td>
                      <td className="px-2 py-2.5">
                        <form action={updateVariantStockAction} className="flex items-center gap-1.5">
                          <input type="hidden" name="variantId" value={variant.id} />
                          <input type="hidden" name="productId" value={product.id} />
                          <input
                            name="stockQuantity"
                            type="number"
                            min="0"
                            defaultValue={variant.stockQuantity ?? ""}
                            className="w-16 rounded-md border border-stone-200 px-1.5 py-1 text-[11px]"
                            aria-label={`Stock quantity for ${variant.title}`}
                          />
                          <select
                            name="stockStatus"
                            defaultValue={variant.stockStatus}
                            className="rounded-md border border-stone-200 px-1.5 py-1 text-[10.5px]"
                            aria-label={`Stock status for ${variant.title}`}
                          >
                            <option value="in_stock">In stock</option>
                            <option value="out_of_stock">Out</option>
                          </select>
                          <button
                            type="submit"
                            className="rounded-md border border-stone-300 px-2 py-1 text-[10.5px] font-medium hover:bg-stone-50"
                          >
                            Save
                          </button>
                        </form>
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        <form action={deleteVariantAction}>
                          <input type="hidden" name="variantId" value={variant.id} />
                          <input type="hidden" name="productId" value={product.id} />
                          <ConfirmSubmitButton
                            confirmMessage={`Delete variant ${variant.sku}? Cart lines using it will lose the variant.`}
                            className="text-[10.5px] font-medium text-red-600 underline-offset-2 hover:underline"
                          >
                            Delete
                          </ConfirmSubmitButton>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            This product has no variants. The assistant cannot add it to a cart until you add at least one.
          </p>
        )}

        <form action={createVariantAction} className="mt-5 rounded-lg border border-stone-200 bg-stone-50 p-3">
          <input type="hidden" name="productId" value={product.id} />
          <p className="text-[11.5px] font-semibold text-stone-800">Add a variant</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <div>
              <label htmlFor="variant-title" className="text-[10px] font-medium text-stone-500">
                Title
              </label>
              <input id="variant-title" name="title" required className={inputClass} placeholder="Black" />
            </div>
            <div>
              <label htmlFor="variant-sku" className="text-[10px] font-medium text-stone-500">
                SKU
              </label>
              <input id="variant-sku" name="sku" required className={inputClass} placeholder="UTB-BLK" />
            </div>
            <div>
              <label htmlFor="variant-external" className="text-[10px] font-medium text-stone-500">
                External variant ID
              </label>
              <input id="variant-external" name="externalVariantId" className={inputClass} placeholder="optional" />
            </div>
            <div>
              <label htmlFor="variant-price" className="text-[10px] font-medium text-stone-500">
                Price override ({store.currency})
              </label>
              <input
                id="variant-price"
                name="priceOverride"
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                placeholder="blank = product price"
              />
            </div>
            <div>
              <label htmlFor="variant-stock" className="text-[10px] font-medium text-stone-500">
                Stock quantity
              </label>
              <input id="variant-stock" name="stockQuantity" type="number" min="0" className={inputClass} placeholder="optional" />
            </div>
            <div>
              <label htmlFor="variant-status" className="text-[10px] font-medium text-stone-500">
                Stock status
              </label>
              <select id="variant-status" name="stockStatus" className={inputClass} defaultValue="in_stock">
                <option value="in_stock">In stock</option>
                <option value="out_of_stock">Out of stock</option>
              </select>
            </div>
            <div className="sm:col-span-3">
              <label htmlFor="variant-options" className="text-[10px] font-medium text-stone-500">
                Options (JSON)
              </label>
              <input
                id="variant-options"
                name="options"
                className={`${inputClass} font-mono`}
                defaultValue='{"color":"Black"}'
              />
            </div>
          </div>
          <button
            type="submit"
            className="mt-2.5 rounded-lg bg-stone-900 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-stone-800"
          >
            Add variant
          </button>
        </form>
      </section>

      <section className="mt-5 rounded-xl border border-red-200 bg-white p-5">
        <h2 className="text-[13px] font-semibold text-red-700">Danger zone</h2>
        <p className="mt-1 text-[10.5px] leading-relaxed text-stone-500">
          Deleting this product also deletes its variants and cart lines. Conversations and checkout
          snapshots keep their recorded names.
        </p>
        <form action={deleteProductAction} className="mt-3">
          <input type="hidden" name="id" value={product.id} />
          <ConfirmSubmitButton
            confirmMessage={`Permanently delete ${product.name}? This cannot be undone.`}
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-[11.5px] font-semibold text-red-700 transition hover:bg-red-100"
          >
            Delete product
          </ConfirmSubmitButton>
        </form>
      </section>
    </div>
  );
}
