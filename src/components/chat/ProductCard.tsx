"use client";

import Image from "next/image";
import { useState } from "react";
import { formatMoney } from "@/lib/client/format";
import type { ProductCardData } from "@/types/chat";

type ProductCardProps = {
  product: ProductCardData;
  accent: string;
  busy?: boolean;
  /** Position in the list, for a staggered entrance. */
  index?: number;
  /** row: detailed horizontal card · tile: compact vertical card for carousels */
  layout?: "row" | "tile";
  onAdd: (productId: string, variantId: string | null) => void;
};

export function ProductCard({ product, accent, busy, index = 0, layout = "row", onAdd }: ProductCardProps) {
  const firstAvailable = product.variants.find((variant) => variant.available) ?? product.variants[0] ?? null;
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(firstAvailable?.id ?? null);
  const selectedVariant = product.variants.find((variant) => variant.id === selectedVariantId) ?? null;
  const priceMinor = selectedVariant?.priceMinor ?? product.priceMinor;
  const canAdd = product.available && (!selectedVariant || selectedVariant.available);

  if (layout === "tile") {
    return (
      <div
        data-testid="product-card"
        className="flex w-[168px] shrink-0 snap-start animate-fade-up flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        style={{ animationDelay: `${index * 70}ms`, animationFillMode: "both" }}
      >
        <div className="relative h-28 w-full bg-stone-100">
          <span className="absolute left-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-[10.5px] font-bold text-stone-700 shadow-sm">
            {index + 1}
          </span>
          {product.imageUrl ? (
            <Image src={product.imageUrl} alt={product.name} fill sizes="168px" unoptimized className="object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-stone-300">
              {product.name.charAt(0)}
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col p-2">
          <p className="line-clamp-2 text-[12px] font-semibold leading-tight text-stone-900">{product.name}</p>
          <p className="mt-0.5 text-[12.5px] font-bold" style={{ color: accent }}>
            {formatMoney(priceMinor, product.currency)}
          </p>
          {product.variants.length > 1 ? (
            <select
              aria-label={`Choose a variant for ${product.name}`}
              value={selectedVariantId ?? ""}
              onChange={(event) => setSelectedVariantId(event.target.value)}
              className="mb-1.5 mt-1.5 w-full rounded-md border border-stone-200 bg-stone-50 px-1.5 py-1 text-[11px] text-stone-700"
            >
              {product.variants.map((variant) => (
                <option key={variant.id} value={variant.id} disabled={!variant.available}>
                  {variant.title}
                  {variant.available ? "" : " — sold out"}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            onClick={() => onAdd(product.id, selectedVariant?.id ?? null)}
            disabled={!canAdd || busy}
            className="mt-auto w-full rounded-lg py-1.5 text-[11.5px] font-semibold text-white transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: accent }}
          >
            {busy ? "Adding…" : canAdd ? "Add to cart" : "Sold out"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="product-card"
      className="flex animate-fade-up gap-3 rounded-xl border border-stone-200 bg-white p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      style={{ animationDelay: `${index * 70}ms`, animationFillMode: "both" }}
    >
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-stone-100">
        {product.imageUrl ? (
          <Image src={product.imageUrl} alt={product.name} fill sizes="80px" unoptimized className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-stone-400">
            {product.name.charAt(0)}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-tight text-stone-900">{product.name}</p>
            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-stone-500">
              {product.brand ? `${product.brand} · ` : ""}
              {product.category}
            </p>
          </div>
          <p className="shrink-0 text-[13px] font-semibold text-stone-900">
            {formatMoney(priceMinor, product.currency)}
          </p>
        </div>

        <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-stone-500">{product.description}</p>

        <div className="mt-2 flex items-center gap-1.5">
          {product.variants.length > 1 ? (
            <select
              aria-label={`Choose a variant for ${product.name}`}
              value={selectedVariantId ?? ""}
              onChange={(event) => setSelectedVariantId(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1 text-[11.5px] text-stone-700"
            >
              {product.variants.map((variant) => (
                <option key={variant.id} value={variant.id} disabled={!variant.available}>
                  {variant.title}
                  {variant.available ? "" : " — out of stock"}
                </option>
              ))}
            </select>
          ) : (
            <p className="min-w-0 flex-1 truncate text-[11.5px] text-stone-500">
              {product.variants[0]?.title ?? "Standard"}
              {product.available ? "" : " — out of stock"}
            </p>
          )}

          <button
            type="button"
            onClick={() => onAdd(product.id, selectedVariant?.id ?? null)}
            disabled={!canAdd || busy}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: accent }}
          >
            {busy ? "Adding..." : canAdd ? "Add" : "Sold out"}
          </button>
        </div>
      </div>
    </div>
  );
}
