import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { executeTool } from "@/modules/ai/tools";
import { getCartSummary } from "@/modules/cart/cart.service";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;

// Like the store's Cotton Kurti: versions named Small/Medium/Large, sizes stored as S/M/L.
async function seedKurti() {
  const kurti = await prisma.product.create({
    data: { storeId: fx.storeA.id, name: "Cotton Kurti", slug: "cotton-kurti", description: "Straight-cut cotton kurti.", category: "Clothing", priceMinor: 190000, currency: "BDT", attributes: JSON.stringify({ sizes: "S, M, L" }) },
  });
  for (const [title, size, sku] of [["Small", "S", "CK-S"], ["Medium", "M", "CK-M"], ["Large", "L", "CK-L"]] as const) {
    await prisma.productVariant.create({ data: { productId: kurti.id, storeId: fx.storeA.id, sku, title, options: JSON.stringify({ size }), stockQuantity: 5 } });
  }
  return kurti;
}

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

describe("choosing a size", () => {
  for (const said of ["Medium", "M", "medium size", "size M"]) {
    it(`adds the Medium kurti when the size is given as "${said}"`, async () => {
      await seedKurti();
      const session = await newSession();
      const result = await executeTool({ session }, "add_to_cart", JSON.stringify({ product: "Cotton Kurti", variant: said }));
      expect(result.ok, JSON.stringify(result.content)).toBe(true);
      const cart = await getCartSummary(session.sessionId, session.storeId, "BDT");
      expect(cart.items.map((item) => `${item.name} (${item.variantTitle})`)).toEqual(["Cotton Kurti (Medium)"]);
    });
  }

  it("finds the kurti in the Medium size when searching with a size filter", async () => {
    await seedKurti();
    const session = await newSession();
    const result = await executeTool({ session }, "search_products", JSON.stringify({ query: "cotton kurti", filters: { size: "Medium" } }));
    expect((result.content as { matched: boolean }).matched).toBe(true);
  });
});
