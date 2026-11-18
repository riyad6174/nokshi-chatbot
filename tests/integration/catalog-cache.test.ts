import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { invalidateCatalog, searchProducts } from "@/modules/catalog/product.service";
import { resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
  invalidateCatalog();
  process.env.CATALOG_CACHE_TTL_MS = "60000";
});

afterEach(() => {
  process.env.CATALOG_CACHE_TTL_MS = "0";
  invalidateCatalog();
});

const names = async () => (await searchProducts({ storeId: fx.storeA.id, limit: 24 })).map((product) => product.name);

describe("catalog cache", () => {
  it("serves repeated searches from memory until the catalog is invalidated", async () => {
    expect(await names()).toContain("Canvas Tote");
    await prisma.product.update({ where: { id: fx.products.tote.id }, data: { status: "inactive" } });

    // Still cached: the write above skipped the hooks.
    expect(await names()).toContain("Canvas Tote");

    invalidateCatalog(fx.storeA.id);
    expect(await names()).not.toContain("Canvas Tote");
  });

  it("keeps each store's catalog separate", async () => {
    const storeB = await searchProducts({ storeId: fx.storeB.id, limit: 24 });
    expect(storeB.map((product) => product.name)).not.toContain("Canvas Tote");
    expect(await names()).toContain("Canvas Tote");
  });
});

describe("search word matching", () => {
  const search = async (text: string) => (await searchProducts({ storeId: fx.storeA.id, text })).map((product) => product.name);

  it("finds products by the plural of their name", async () => {
    expect(await search("totes")).toContain("Canvas Tote");
  });

  it("forgives a typo only when nothing matched as written", async () => {
    expect(await search("backpak")).toContain("Trail Backpack");
    // Spelled right: the exact match only, no near-misses mixed in.
    expect(await search("scarf")).toEqual(["Handloom Scarf"]);
  });
});
