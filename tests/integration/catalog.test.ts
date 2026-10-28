import { beforeEach, describe, expect, it } from "vitest";
import { getProductById, searchProducts } from "@/modules/catalog/product.service";
import { searchKnowledge } from "@/modules/knowledge/retrieval.service";
import { resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

describe("product search", () => {
  it("finds products by name, category, and attribute", async () => {
    const byName = await searchProducts({ storeId: fx.storeA.id, text: "tote" });
    expect(byName.map((p) => p.id)).toEqual([fx.products.tote.id]);

    const byCategory = await searchProducts({ storeId: fx.storeA.id, category: "bags" });
    expect(byCategory.map((p) => p.name).sort()).toEqual(["Canvas Tote", "Trail Backpack"]);

    const byAttribute = await searchProducts({ storeId: fx.storeA.id, text: "24L" });
    expect(byAttribute[0]?.id).toBe(fx.products.backpack.id);
  });

  it("never returns inactive products or another store's products", async () => {
    const results = await searchProducts({ storeId: fx.storeA.id, text: "backpack" });
    const ids = results.map((p) => p.id);
    expect(ids).toContain(fx.products.backpack.id);
    expect(ids).not.toContain(fx.products.retired.id);
    expect(ids).not.toContain(fx.products.foreign.id);

    expect(await getProductById(fx.storeA.id, fx.products.foreign.id)).toBeNull();
    expect(await getProductById(fx.storeA.id, fx.products.retired.id)).toBeNull();
  });

  it("applies the budget filter using current catalog prices", async () => {
    const results = await searchProducts({ storeId: fx.storeA.id, maxPriceMinor: 130000 });
    expect(results.map((p) => p.name).sort()).toEqual(["Canvas Tote", "Handloom Scarf"]);
    for (const product of results) expect(product.priceMinor).toBeLessThanOrEqual(130000);
  });

  it("returns an empty list rather than inventing a match", async () => {
    expect(await searchProducts({ storeId: fx.storeA.id, text: "submarine" })).toEqual([]);
  });

  it("exposes correct variant prices and availability", async () => {
    const product = await getProductById(fx.storeA.id, fx.products.backpack.id);
    const byTitle = Object.fromEntries(product!.variants.map((v) => [v.title, v]));
    expect(byTitle.Black).toMatchObject({ priceMinor: 250000, available: true });
    expect(byTitle.Olive).toMatchObject({ priceMinor: 270000, available: true });
    expect(byTitle.Red).toMatchObject({ available: false });
  });
});

describe("knowledge search", () => {
  it("is scoped to the current store", async () => {
    const hits = await searchKnowledge(fx.storeA.id, "delivery");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.snippet).toContain("Dhaka");
    expect(hits[0]!.snippet).not.toContain("drone");
  });

  it("ignores documents that are not ready", async () => {
    const { prisma } = await import("@/lib/db/prisma");
    await prisma.knowledgeDocument.updateMany({ where: { storeId: fx.storeA.id }, data: { status: "pending" } });
    expect(await searchKnowledge(fx.storeA.id, "delivery")).toEqual([]);
  });
});
