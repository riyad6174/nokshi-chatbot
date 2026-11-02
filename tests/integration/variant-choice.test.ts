import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { executeTool } from "@/modules/ai/tools";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;
let watch: { id: string; black: string; silver: string };

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
  // Like the store's Minimalist Wrist Watch: one version sold out, one in stock.
  const product = await prisma.product.create({
    data: { storeId: fx.storeA.id, name: "Minimalist Wrist Watch", slug: "watch", description: "38 mm", category: "Accessories", priceMinor: 450000, currency: "BDT" },
  });
  const black = await prisma.productVariant.create({
    data: { productId: product.id, storeId: fx.storeA.id, sku: "MWW-BLK", title: "Black / Black leather", stockStatus: "out_of_stock", stockQuantity: 0 },
  });
  const silver = await prisma.productVariant.create({
    data: { productId: product.id, storeId: fx.storeA.id, sku: "MWW-SLV", title: "Silver / Tan leather", stockQuantity: 2 },
  });
  watch = { id: product.id, black: black.id, silver: silver.id };
});

type Content = { ok: boolean; error?: { code: string; message: string }; cart?: { items: Array<{ variantTitle: string | null }> } };

async function add(args: Record<string, unknown>) {
  const session = await newSession();
  return (await executeTool({ session }, "add_to_cart", JSON.stringify(args))).content as Content;
}

describe("adding a product whose other version is sold out", () => {
  it("adds the in-stock version when no version is given", async () => {
    const content = await add({ productId: watch.id });
    expect(content.ok).toBe(true);
    expect(content.cart?.items[0]?.variantTitle).toBe("Silver / Tan leather");
  });

  it("adds a version named in words, without an id", async () => {
    expect((await add({ productId: watch.id, variant: "Silver / Tan leather" })).cart?.items[0]?.variantTitle).toBe("Silver / Tan leather");
    expect((await add({ productId: watch.id, variant: "silver" })).cart?.items[0]?.variantTitle).toBe("Silver / Tan leather");
  });

  it("says only that version is sold out, and which one is available", async () => {
    const content = await add({ productId: watch.id, variantId: watch.black });
    expect(content.error?.code).toBe("variant_unavailable");
    expect(content.error?.message).toContain('Only the "Black / Black leather" version is out of stock');
    expect(content.error?.message).toContain("Silver / Tan leather");
  });

  it("still asks which version when several are in stock", async () => {
    const content = await add({ productId: fx.products.backpack.id });
    expect(content.error?.code).toBe("variant_required");
  });
});
