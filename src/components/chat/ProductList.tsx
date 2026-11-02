"use client";

import { ProductCard } from "@/components/chat/ProductCard";
import type { ProductCardData } from "@/types/chat";

type ProductListProps = {
  products: ProductCardData[];
  accent: string;
  busyProductId?: string | null;
  onAdd: (productId: string, variantId: string | null) => void;
};

/** One product: a detailed card. Several: a swipeable, numbered carousel ("the second one"). */
export function ProductList({ products, accent, busyProductId, onAdd }: ProductListProps) {
  if (products.length === 0) return null;
  if (products.length === 1) {
    const product = products[0]!;
    return <ProductCard product={product} accent={accent} busy={busyProductId === product.id} onAdd={onAdd} />;
  }
  return (
    <div className="chat-scroll -mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1.5">
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          index={index}
          layout="tile"
          product={product}
          accent={accent}
          busy={busyProductId === product.id}
          onAdd={onAdd}
        />
      ))}
    </div>
  );
}
