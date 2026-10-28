"use client";

import { ProductCard } from "@/components/chat/ProductCard";
import type { ProductCardData } from "@/types/chat";

type ProductListProps = {
  products: ProductCardData[];
  accent: string;
  busyProductId?: string | null;
  onAdd: (productId: string, variantId: string | null) => void;
};

export function ProductList({ products, accent, busyProductId, onAdd }: ProductListProps) {
  if (products.length === 0) return null;
  return (
    <div className="mt-2 w-full space-y-2">
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          index={index}
          product={product}
          accent={accent}
          busy={busyProductId === product.id}
          onAdd={onAdd}
        />
      ))}
    </div>
  );
}
