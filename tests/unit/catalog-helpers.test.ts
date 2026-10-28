import { describe, expect, it } from "vitest";
import { assertNonNegativeMinor, takaToMinor } from "@/lib/money";
import {
  effectivePriceMinor,
  isProductAvailable,
  variantAvailable,
  variantPriceMinor,
} from "@/modules/catalog/product.service";

const variant = (overrides: Partial<{ priceOverrideMinor: number | null; stockStatus: string; stockQuantity: number | null }>) => ({
  priceOverrideMinor: null,
  stockStatus: "in_stock",
  stockQuantity: null,
  ...overrides,
});

describe("money", () => {
  it("converts to integer minor units without float drift", () => {
    expect(takaToMinor(19.99)).toBe(1999);
    expect(takaToMinor(0.1 + 0.2)).toBe(30);
  });

  it("rejects fractional or negative minor amounts", () => {
    expect(() => assertNonNegativeMinor(10.5)).toThrow();
    expect(() => assertNonNegativeMinor(-1)).toThrow();
    expect(assertNonNegativeMinor(0)).toBe(0);
  });
});

describe("variant pricing and availability", () => {
  it("uses the variant override when present", () => {
    expect(variantPriceMinor({ priceMinor: 1000 }, variant({ priceOverrideMinor: 1500 }))).toBe(1500);
    expect(variantPriceMinor({ priceMinor: 1000 }, variant({}))).toBe(1000);
    expect(variantPriceMinor({ priceMinor: 1000 }, null)).toBe(1000);
  });

  it("treats out_of_stock and zero quantity as unavailable", () => {
    expect(variantAvailable(variant({ stockStatus: "out_of_stock" }))).toBe(false);
    expect(variantAvailable(variant({ stockQuantity: 0 }))).toBe(false);
    expect(variantAvailable(variant({ stockQuantity: 2 }))).toBe(true);
    expect(variantAvailable(variant({}))).toBe(true);
  });

  it("derives product price and availability from its variants", () => {
    const product = {
      priceMinor: 1000,
      status: "active",
      variants: [variant({ priceOverrideMinor: 1200 }), variant({ priceOverrideMinor: 900, stockQuantity: 0 })],
    } as unknown as Parameters<typeof effectivePriceMinor>[0];
    // The 900 variant is sold out, so the product is priced from the purchasable 1200 variant.
    expect(effectivePriceMinor(product)).toBe(1200);
    expect(isProductAvailable(product)).toBe(true);
    expect(isProductAvailable({ ...product, status: "inactive" })).toBe(false);
  });
});
