"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProductCard } from "@/components/chat/ProductCard";
import type { ProductCardData } from "@/types/chat";

type ProductListProps = {
  products: ProductCardData[];
  accent: string;
  busyProductId?: string | null;
  onAdd: (productId: string, variantId: string | null) => void;
  /** grid: the floating product grid (up to 3 rows) · carousel: a swipeable row in the narrow text chat. */
  display?: "grid" | "carousel";
};

/** 4 per row on wide screens, 3 rows at most. */
const GRID_MAX = 12;

/**
 * One product: a featured card. Several: numbered tiles ("the second one"), in a grid or in a row
 * that swipes on touch and has previous/next arrows and position dots.
 */
export function ProductList({ products, accent, busyProductId, onAdd, display = "carousel" }: ProductListProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const [active, setActive] = useState(0);
  /** Whole products in view: the arrows move a page at a time. */
  const [perView, setPerView] = useState(1);

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const max = track.scrollWidth - track.clientWidth;
    setEdges({ start: track.scrollLeft <= 4, end: track.scrollLeft >= max - 4 });
    const first = track.firstElementChild as HTMLElement | null;
    const step = first ? first.offsetWidth + 8 : track.clientWidth;
    setActive(Math.min(products.length - 1, Math.round(track.scrollLeft / step)));
    setPerView(Math.max(1, Math.floor((track.clientWidth + 8) / step)));
  }, [products.length]);

  useEffect(() => {
    measure();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [measure]);

  const scrollToIndex = (index: number) => {
    const track = trackRef.current;
    const card = track?.children[index] as HTMLElement | undefined;
    if (track && card) track.scrollTo({ left: card.offsetLeft - track.offsetLeft, behavior: "smooth" });
  };

  if (products.length === 0) return null;
  if (products.length === 1) {
    const product = products[0]!;
    return <ProductCard product={product} accent={accent} busy={busyProductId === product.id} onAdd={onAdd} />;
  }

  if (display === "grid") {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {products.slice(0, GRID_MAX).map((product, index) => (
          <ProductCard
            key={product.id}
            index={index}
            layout="tile"
            dense
            product={product}
            accent={accent}
            busy={busyProductId === product.id}
            onAdd={onAdd}
          />
        ))}
      </div>
    );
  }

  const arrow = (direction: -1 | 1) => (
    <button
      type="button"
      onClick={() => scrollToIndex(Math.max(0, Math.min(products.length - 1, active + direction * perView)))}
      disabled={direction < 0 ? edges.start : edges.end}
      aria-label={direction < 0 ? "Previous products" : "Next products"}
      className={`absolute top-[38%] z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white text-stone-800 ring-1 ring-stone-200 transition hover:scale-105 hover:bg-stone-50 active:scale-95 disabled:pointer-events-none disabled:opacity-0 ${
        direction < 0 ? "-left-2" : "-right-2"
      }`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4">
        <path d={direction < 0 ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
      </svg>
    </button>
  );

  return (
    <div className="relative">
      {arrow(-1)}
      <div
        ref={trackRef}
        onScroll={measure}
        className="chat-scroll -mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth px-1 pb-2"
        role="region"
        aria-label={`${products.length} products, swipe or use the arrows`}
      >
        {products.map((product, index) => (
          <ProductCard
            key={product.id}
            index={index}
            layout="tile"
            tileWidth="w-[172px]"
            product={product}
            accent={accent}
            busy={busyProductId === product.id}
            onAdd={onAdd}
          />
        ))}
      </div>
      {arrow(1)}
      <div className="mt-1 flex justify-center gap-1.5" aria-hidden="true">
        {products.map((product, index) => (
          <button
            key={product.id}
            type="button"
            tabIndex={-1}
            onClick={() => scrollToIndex(index)}
            className={`h-1.5 rounded-full transition-all duration-300 ${index === active ? "w-5 bg-stone-800" : "w-1.5 bg-stone-300 hover:bg-stone-400"}`}
          />
        ))}
      </div>
    </div>
  );
}
