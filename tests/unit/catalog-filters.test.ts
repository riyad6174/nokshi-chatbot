import { describe, expect, it } from "vitest";
import { matchesFilters } from "@/modules/catalog/product.service";

// The store's Cotton Kurti: sizes stored as codes (S/M/L) with names (Small/Medium/Large).
const variant = (title: string, size: string, stockStatus = "in_stock") => ({ title, options: JSON.stringify({ size }), stockStatus, stockQuantity: 5 });
const kurti = {
  attributes: JSON.stringify({ fabric: "100% cotton", sizes: "S, M, L" }),
  variants: [variant("Large", "L"), variant("Medium", "M"), variant("Small", "S"), variant("Extra Large", "XL", "out_of_stock")],
} as never;
const backpack = {
  attributes: "{}",
  variants: [{ title: "Olive", options: JSON.stringify({ color: "Olive" }), stockStatus: "in_stock", stockQuantity: 3 }],
} as never;

describe("search filters on sizes and colours", () => {
  it("finds a size asked by name when it's stored as a code (the 'medium kurti not available' bug)", () => {
    expect(matchesFilters(kurti, { size: "Medium" })).toBe(true);
    expect(matchesFilters(kurti, { size: "M" })).toBe(true);
    expect(matchesFilters(kurti, { size: "small" })).toBe(true);
    expect(matchesFilters(kurti, { size: "Large" })).toBe(true);
  });

  it("still says no for a size that's sold out or doesn't exist", () => {
    expect(matchesFilters(kurti, { size: "Extra Large" })).toBe(false);
    expect(matchesFilters(kurti, { size: "XXL" })).toBe(false);
  });

  it("matches colours by option or variant name", () => {
    expect(matchesFilters(backpack, { color: "olive" })).toBe(true);
    expect(matchesFilters(backpack, { color: "Red" })).toBe(false);
  });
});

describe("size words and codes", () => {
  it("treats a size word and its code as the same size", async () => {
    const { sizeCode } = await import("@/modules/catalog/product.service");
    expect(sizeCode("Medium")).toBe(sizeCode("M"));
    expect(sizeCode(" large ")).toBe("l");
    expect(sizeCode("Extra Large")).toBe("xl");
    expect(sizeCode("Olive")).toBe("olive");
  });
});
