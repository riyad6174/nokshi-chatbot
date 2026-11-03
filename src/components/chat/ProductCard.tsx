"use client";

import Image from "next/image";
import { useState } from "react";
import { formatMoney } from "@/lib/client/format";
import type { ProductCardData, ProductVariantData } from "@/types/chat";

type ProductCardProps = {
  product: ProductCardData;
  accent: string;
  busy?: boolean;
  /** Position in the list: the number badge ("the second one") and a staggered entrance. */
  index?: number;
  /**
   * row: featured horizontal card for a single product · tile: vertical card in a grid (fills its
   * cell) or a carousel (fixed width).
   */
  layout?: "row" | "tile";
  /** Tile width in a slider, e.g. "w-[172px]"; without it a tile fills its container. */
  tileWidth?: string;
  /** Grid tile: shorter image, add button beside the price, so several rows fit on screen. */
  dense?: boolean;
  onAdd: (productId: string, variantId: string | null) => void;
};

const MAX_CHIPS = 4;

/** Versions as tappable chips (colour, size…); sold-out ones are shown but can't be picked. */
function VariantChips({
  variants,
  selectedId,
  accent,
  onSelect,
  compact,
}: {
  variants: ProductVariantData[];
  selectedId: string | null;
  accent: string;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  if (variants.length <= 1) return null;
  const shown = variants.slice(0, MAX_CHIPS);
  const more = variants.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Choose a version">
      {shown.map((variant) => {
        const selected = variant.id === selectedId;
        return (
          <button
            key={variant.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!variant.available}
            onClick={() => onSelect(variant.id)}
            title={variant.available ? variant.title : `${variant.title}: sold out`}
            className={`max-w-full truncate rounded-full border px-2 transition ${compact ? "py-0.5 text-[10.5px]" : "py-1 text-[11px]"} ${
              selected
                ? "font-semibold text-white"
                : variant.available
                  ? "border-stone-200 bg-white text-stone-700 hover:border-stone-400"
                  : "cursor-not-allowed border-dashed border-stone-200 bg-stone-50 text-stone-400 line-through"
            }`}
            style={selected ? { backgroundColor: accent, borderColor: accent } : undefined}
          >
            {variant.title}
          </button>
        );
      })}
      {more > 0 ? <span className="self-center text-[10.5px] text-stone-400">+{more}</span> : null}
    </div>
  );
}

function ProductImage({ product, sizes, className }: { product: ProductCardData; sizes: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-stone-100 to-stone-200 ${className ?? ""}`}>
      {product.imageUrl ? (
        <Image
          src={product.imageUrl}
          alt={product.name}
          fill
          sizes={sizes}
          unoptimized
          className="object-cover transition duration-500 ease-out group-hover:scale-[1.06]"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-3xl font-semibold text-stone-300">{product.name.charAt(0)}</div>
      )}
      {!product.available ? (
        <span className="absolute inset-x-0 bottom-0 bg-stone-900/70 py-1 text-center text-[10.5px] font-semibold uppercase tracking-wide text-white">
          Sold out
        </span>
      ) : null}
    </div>
  );
}

function AddButton({
  canAdd,
  busy,
  accent,
  label,
  onClick,
}: {
  canAdd: boolean;
  busy?: boolean;
  accent: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!canAdd || busy}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-[12px] font-semibold text-white transition hover:brightness-110 active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-stone-300 disabled:opacity-80"
      style={canAdd ? { backgroundColor: accent } : undefined}
    >
      {busy ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
      ) : (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="20" r="1.3" />
          <circle cx="18" cy="20" r="1.3" />
          <path d="M2.5 3h2.6l2.4 12h11l2-8.5H6.2" />
        </svg>
      )}
      {busy ? "Adding…" : canAdd ? label : "Sold out"}
    </button>
  );
}

export function ProductCard({ product, accent, busy, index = 0, layout = "row", tileWidth, dense = false, onAdd }: ProductCardProps) {
  const firstAvailable = product.variants.find((variant) => variant.available) ?? product.variants[0] ?? null;
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(firstAvailable?.id ?? null);
  const selectedVariant = product.variants.find((variant) => variant.id === selectedVariantId) ?? null;
  const priceMinor = selectedVariant?.priceMinor ?? product.priceMinor;
  const canAdd = product.available && (!selectedVariant || selectedVariant.available);
  const add = () => onAdd(product.id, selectedVariant?.id ?? null);
  const meta = [product.brand, product.category].filter(Boolean).join(" · ");

  if (layout === "tile" && dense) {
    return (
      <article
        data-testid="product-card"
        className="group card-float-in flex w-full flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-black/5 transition duration-300 hover:-translate-y-1"
        style={{ animationDelay: `${index * 55}ms` }}
      >
        <div className="relative">
          <ProductImage product={product} sizes="(min-width: 1024px) 220px, (min-width: 640px) 30vw, 45vw" className="aspect-[16/11] w-full" />
          <span className="absolute left-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-white/95 px-1.5 text-[11px] font-bold text-stone-800 ring-1 ring-black/5">
            {index + 1}
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-2.5">
          <div className="min-w-0">
            {meta ? <p className="truncate text-[9.5px] font-semibold uppercase tracking-[0.12em] text-stone-400">{meta}</p> : null}
            <p className="truncate text-[13px] font-semibold text-stone-900" title={product.name}>
              {product.name}
            </p>
          </div>
          <VariantChips variants={product.variants} selectedId={selectedVariantId} accent={accent} onSelect={setSelectedVariantId} compact />
          <div className="mt-auto flex items-center justify-between gap-2 pt-0.5">
            <p className="text-[15px] font-bold tracking-tight" style={{ color: accent }}>
              {formatMoney(priceMinor, product.currency)}
            </p>
            <button
              type="button"
              onClick={add}
              disabled={!canAdd || busy}
              aria-label={canAdd ? `Add ${product.name} to cart` : `${product.name} is sold out`}
              title={canAdd ? "Add to cart" : "Sold out"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition hover:scale-105 hover:brightness-110 active:scale-90 disabled:cursor-not-allowed disabled:bg-stone-300"
              style={canAdd ? { backgroundColor: accent } : undefined}
            >
              {busy ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </article>
    );
  }

  if (layout === "tile") {
    return (
      <article
        data-testid="product-card"
        className={`group flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white transition duration-300 hover:-translate-y-1 hover:border-stone-300 card-float-in ${
          tileWidth ? `${tileWidth} shrink-0 snap-start` : "w-full"
        }`}
        style={{ animationDelay: `${index * 70}ms` }}
      >
        <div className="relative">
          <ProductImage product={product} sizes="(min-width: 640px) 200px, 45vw" className="aspect-[4/3] w-full" />
          <span className="absolute left-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-white/95 px-1.5 text-[11px] font-bold text-stone-800 ring-1 ring-black/5">
            {index + 1}
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-2.5">
          {meta ? <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400">{meta}</p> : null}
          <p className="line-clamp-2 min-h-[2.4em] text-[13px] font-semibold leading-tight text-stone-900">{product.name}</p>
          <p className="text-[15px] font-bold tracking-tight" style={{ color: accent }}>
            {formatMoney(priceMinor, product.currency)}
          </p>
          <VariantChips variants={product.variants} selectedId={selectedVariantId} accent={accent} onSelect={setSelectedVariantId} compact />
          <div className="mt-auto pt-1">
            <AddButton canAdd={canAdd} busy={busy} accent={accent} label="Add" onClick={add} />
          </div>
        </div>
      </article>
    );
  }

  // A single product: a featured card with the details.
  return (
    <article
      data-testid="product-card"
      className="group card-float-in flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white sm:flex-row"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <ProductImage product={product} sizes="(min-width: 640px) 200px, 100vw" className="aspect-[16/10] w-full shrink-0 sm:aspect-auto sm:w-[44%]" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3.5">
        <div>
          {meta ? <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.12em] text-stone-400">{meta}</p> : null}
          <p className="mt-0.5 text-[16px] font-semibold leading-snug text-stone-900">{product.name}</p>
        </div>
        <p className="line-clamp-3 text-[12px] leading-relaxed text-stone-500">{product.description}</p>
        <VariantChips variants={product.variants} selectedId={selectedVariantId} accent={accent} onSelect={setSelectedVariantId} />
        <div className="mt-auto flex items-center gap-3 pt-1">
          <p className="shrink-0 text-[18px] font-bold tracking-tight" style={{ color: accent }}>
            {formatMoney(priceMinor, product.currency)}
          </p>
          <AddButton canAdd={canAdd} busy={busy} accent={accent} label="Add to cart" onClick={add} />
        </div>
      </div>
    </article>
  );
}
