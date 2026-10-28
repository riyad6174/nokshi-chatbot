import Link from "next/link";

export type ProductFormValues = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  price: number;
  imageUrl: string;
  externalProductId: string;
  status: string;
};

type ProductFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  values?: ProductFormValues;
  currency: string;
  submitLabel: string;
  cancelHref: string;
};

const inputClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[13px] text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none";

export function ProductForm({ action, values, currency, submitLabel, cancelHref }: ProductFormProps) {
  return (
    <form action={action} className="space-y-4">
      {values?.id ? <input type="hidden" name="id" value={values.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="product-name" className="text-[11.5px] font-semibold text-stone-700">
            Name
          </label>
          <input
            id="product-name"
            name="name"
            required
            maxLength={200}
            defaultValue={values?.name}
            className={inputClass}
            placeholder="Urban Trek Backpack"
          />
        </div>
        <div>
          <label htmlFor="product-slug" className="text-[11.5px] font-semibold text-stone-700">
            Slug
          </label>
          <input
            id="product-slug"
            name="slug"
            required
            maxLength={120}
            defaultValue={values?.slug}
            className={inputClass}
            placeholder="urban-trek-backpack"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
          />
          <p className="mt-1 text-[10.5px] text-stone-400">Lowercase letters, numbers, and dashes only.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="product-category" className="text-[11.5px] font-semibold text-stone-700">
            Category
          </label>
          <input
            id="product-category"
            name="category"
            required
            maxLength={100}
            defaultValue={values?.category}
            className={inputClass}
            placeholder="Bags"
          />
        </div>
        <div>
          <label htmlFor="product-price" className="text-[11.5px] font-semibold text-stone-700">
            Price ({currency})
          </label>
          <input
            id="product-price"
            name="price"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={values?.price ?? 0}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="product-status" className="text-[11.5px] font-semibold text-stone-700">
            Status
          </label>
          <select
            id="product-status"
            name="status"
            defaultValue={values?.status ?? "active"}
            className={inputClass}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="product-image" className="text-[11.5px] font-semibold text-stone-700">
            Image URL
          </label>
          <input
            id="product-image"
            name="imageUrl"
            maxLength={500}
            defaultValue={values?.imageUrl}
            className={inputClass}
            placeholder="/products/backpack.svg or https://..."
          />
          <p className="mt-1 text-[10.5px] text-stone-400">Local paths must start with /. Remote URLs must use http(s).</p>
        </div>
        <div>
          <label htmlFor="product-external" className="text-[11.5px] font-semibold text-stone-700">
            External product ID
          </label>
          <input
            id="product-external"
            name="externalProductId"
            maxLength={200}
            defaultValue={values?.externalProductId}
            className={inputClass}
            placeholder="Optional commerce-platform id"
          />
        </div>
      </div>

      <div>
        <label htmlFor="product-description" className="text-[11.5px] font-semibold text-stone-700">
          Description
        </label>
        <textarea
          id="product-description"
          name="description"
          rows={6}
          maxLength={5000}
          defaultValue={values?.description}
          className={inputClass}
          placeholder="Factual product details the assistant may quote."
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          className="rounded-lg bg-stone-900 px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-stone-800"
        >
          {submitLabel}
        </button>
        <Link href={cancelHref} className="text-[12px] font-medium text-stone-500 hover:text-stone-800">
          Cancel
        </Link>
      </div>
    </form>
  );
}
