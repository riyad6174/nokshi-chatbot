"use client";

import { useActionState, useEffect, useState } from "react";
import { previewProductSourceAction, saveProductSourceAction, type PreviewState } from "@/app/admin/chatbot-actions";
import { formatMoney } from "@/lib/client/format";

const inputClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[12px] text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none";
const labelClass = "text-[10.5px] font-medium text-stone-500";

type Field = { key: string; label: string; required?: boolean };

type Props = {
  fields: Field[];
  currency: string;
  initial: {
    mode: "manual" | "api";
    apiUrl: string;
    priceUnit: "major" | "minor";
    autoSync: boolean;
    intervalMinutes: number;
    mapping: Record<string, string>;
  };
};

const INTERVALS = [
  { value: 15, label: "Every 15 minutes" },
  { value: 60, label: "Every hour" },
  { value: 360, label: "Every 6 hours" },
  { value: 1440, label: "Once a day" },
];

export function ProductSourceForm({ fields, currency, initial }: Props) {
  const [mode, setMode] = useState(initial.mode);
  const [mapping, setMapping] = useState<Record<string, string>>(initial.mapping);
  const [preview, previewAction, previewing] = useActionState<PreviewState | null, FormData>(previewProductSourceAction, null);

  // Fill the mapping inputs with whatever the preview detected (admin edits still win next time).
  useEffect(() => {
    if (preview?.mapping) setMapping((current) => ({ ...preview.mapping, ...Object.fromEntries(Object.entries(current).filter(([, value]) => value)) }));
  }, [preview?.mapping]);

  return (
    <form action={saveProductSourceAction} className="mt-3 space-y-4">
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Product source">
        {[
          { value: "manual", title: "Manage in dashboard", body: "Add and edit products on the Products page." },
          { value: "api", title: "Auto entry from an API", body: "Read a public product API and keep the list in sync." },
        ].map((option) => (
          <label
            key={option.value}
            className={`cursor-pointer rounded-xl border p-3 transition ${
              mode === option.value ? "border-stone-900 bg-stone-50" : "border-stone-200 hover:border-stone-300"
            }`}
          >
            <span className="flex items-center gap-2 text-[12.5px] font-semibold text-stone-900">
              <input
                type="radio"
                name="mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => setMode(option.value as "manual" | "api")}
              />
              {option.title}
            </span>
            <span className="mt-0.5 block pl-5 text-[11px] text-stone-500">{option.body}</span>
          </label>
        ))}
      </div>

      {mode === "api" ? (
        <div className="space-y-3 rounded-xl border border-stone-200 p-4">
          <div>
            <label htmlFor="apiUrl" className={labelClass}>
              Product list API URL (public, returns JSON)
            </label>
            <input
              id="apiUrl"
              name="apiUrl"
              type="url"
              defaultValue={initial.apiUrl}
              placeholder="https://api.example.com/products"
              className={`${inputClass} font-mono`}
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="priceUnit" className={labelClass}>
                Prices in the API are
              </label>
              <select id="priceUnit" name="priceUnit" defaultValue={initial.priceUnit} className={inputClass}>
                <option value="major">Whole units (e.g. 1250.50)</option>
                <option value="minor">Minor units (e.g. 125050)</option>
              </select>
            </div>
            <div>
              <label htmlFor="intervalMinutes" className={labelClass}>
                Sync frequency
              </label>
              <select id="intervalMinutes" name="intervalMinutes" defaultValue={String(initial.intervalMinutes)} className={inputClass}>
                {INTERVALS.map((interval) => (
                  <option key={interval.value} value={interval.value}>
                    {interval.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="mt-5 flex items-center gap-2 text-[12px] text-stone-700">
              <input type="checkbox" name="autoSync" defaultChecked={initial.autoSync} /> Keep in sync automatically
            </label>
          </div>

          <details open={Boolean(preview?.mapping)} className="rounded-lg bg-stone-50 p-3">
            <summary className="cursor-pointer text-[11.5px] font-semibold text-stone-700">
              Field mapping (auto-detected; edit if needed)
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {fields.map((field) => (
                <div key={field.key}>
                  <label htmlFor={`map_${field.key}`} className={labelClass}>
                    {field.label}
                    {field.required ? " *" : ""}
                  </label>
                  <input
                    id={`map_${field.key}`}
                    name={`map_${field.key}`}
                    value={mapping[field.key] ?? ""}
                    onChange={(event) => setMapping((current) => ({ ...current, [field.key]: event.target.value }))}
                    placeholder={field.key === "itemsPath" ? "e.g. data.products (empty = top level)" : "auto"}
                    className={`${inputClass} font-mono`}
                  />
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-stone-400">Use dots for nested fields: brand.name, images.0, price.amount.</p>
          </details>

          {preview ? (
            <div className="animate-fade-up">
              {preview.error ? (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[11.5px] text-red-700">
                  {preview.error}
                </p>
              ) : (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[11.5px] text-emerald-800">
                  Found {preview.count} usable products out of {preview.total}
                  {preview.skipped ? ` (${preview.skipped} skipped: missing id, name or price)` : ""}. First {preview.products?.length}:
                </p>
              )}
              {preview.products && preview.products.length > 0 ? (
                <div className="mt-2 overflow-x-auto rounded-lg border border-stone-200">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-stone-50 text-stone-500">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Product</th>
                        <th className="px-2 py-1.5 font-medium">Category</th>
                        <th className="px-2 py-1.5 font-medium">Brand</th>
                        <th className="px-2 py-1.5 text-right font-medium">Price</th>
                        <th className="px-2 py-1.5 text-right font-medium">Stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {preview.products.map((product) => (
                        <tr key={product.externalId}>
                          <td className="px-2 py-1.5">
                            <span className="flex items-center gap-2">
                              {product.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={product.imageUrl} alt="" className="h-7 w-7 rounded object-cover" loading="lazy" />
                              ) : null}
                              <span className="font-medium text-stone-800">{product.name}</span>
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-stone-600">{product.category}</td>
                          <td className="px-2 py-1.5 text-stone-600">{product.brand || "—"}</td>
                          <td className="px-2 py-1.5 text-right">{formatMoney(product.priceMinor, product.currency ?? currency)}</td>
                          <td className="px-2 py-1.5 text-right">{product.stock ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <input type="hidden" name="apiUrl" value={initial.apiUrl} />
          <input type="hidden" name="priceUnit" value={initial.priceUnit} />
          <input type="hidden" name="intervalMinutes" value={initial.intervalMinutes} />
        </>
      )}

      <div className="flex flex-wrap gap-2">
        {mode === "api" ? (
          <button
            type="submit"
            formAction={previewAction}
            formNoValidate
            disabled={previewing}
            className="rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-[11.5px] font-semibold text-stone-800 transition hover:bg-stone-50 disabled:opacity-50"
          >
            {previewing ? "Fetching…" : "Preview products"}
          </button>
        ) : null}
        <button
          type="submit"
          name="intent"
          value="save"
          className="rounded-lg bg-stone-900 px-3.5 py-2 text-[11.5px] font-semibold text-white transition hover:bg-stone-800"
        >
          Save
        </button>
        {mode === "api" ? (
          <button
            type="submit"
            name="intent"
            value="save_and_sync"
            className="rounded-lg bg-teal px-3.5 py-2 text-[11.5px] font-semibold text-white transition hover:brightness-110"
          >
            Save &amp; import now
          </button>
        ) : null}
      </div>
    </form>
  );
}
