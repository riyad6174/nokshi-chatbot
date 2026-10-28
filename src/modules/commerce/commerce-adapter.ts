import type { ProductCardData } from "@/types/chat";

export type CommerceProduct = {
  id: string;
  variantId?: string;
  name: string;
  description?: string;
  imageUrl?: string;
  currency: string;
  priceMinor: number;
  available: boolean;
};

export type CheckoutLine = {
  productId: string;
  variantId: string | null;
  quantity: number;
};

export type CheckoutLineIssue = {
  variantId: string;
  reason: string;
};

export type CheckoutLineSnapshot = {
  productId: string;
  variantId: string | null;
  name: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
};

export type PreparedCheckout = {
  externalCartId?: string;
  token: string;
  checkoutUrl: string;
  currency: string;
  subtotalMinor: number;
  lines: CheckoutLineSnapshot[];
};

export interface CommerceAdapter {
  searchProducts(query: {
    text?: string;
    category?: string;
    maxPriceMinor?: number;
    locale?: string;
  }): Promise<CommerceProduct[]>;

  getProduct(productId: string): Promise<CommerceProduct | null>;

  validateLines(lines: CheckoutLine[]): Promise<{
    valid: boolean;
    issues: CheckoutLineIssue[];
  }>;

  prepareCheckout(input: {
    lines: CheckoutLine[];
    idempotencyKey: string;
    sessionReference?: string;
  }): Promise<PreparedCheckout>;
}

export function toCommerceProduct(product: ProductCardData): CommerceProduct {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    imageUrl: product.imageUrl ?? undefined,
    currency: product.currency,
    priceMinor: product.priceMinor,
    available: product.available,
  };
}
