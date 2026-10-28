import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { detectMapping, normalizeItems, syncProductSource } from "@/modules/catalog/product-sync.service";
import { claimUploads, saveUpload, UploadError } from "@/modules/conversations/upload.service";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

afterEach(() => vi.unstubAllGlobals());

const feed = (items: unknown[]) => ({ data: { total: items.length, products: items } });

function stubFeed(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })),
  );
}

describe("field mapping", () => {
  it("finds the product array and common field names", () => {
    const payload = feed([{ id: 7, title: "Desk Lamp", price: 1250.5, thumbnail: "https://cdn.test/l.jpg", brand: { name: "Lumo" }, stock: 3 }]);
    const mapping = detectMapping(payload);
    expect(mapping).toMatchObject({ itemsPath: "data.products", id: "id", name: "title", price: "price", image: "thumbnail", stock: "stock" });
    const { products } = normalizeItems(payload, { ...mapping, brand: "brand.name" }, "major");
    expect(products[0]).toMatchObject({ externalId: "7", name: "Desk Lamp", priceMinor: 125050, brand: "Lumo", stock: 3 });
  });

  it("skips items without id, name or price, and duplicates", () => {
    const payload = [
      { id: 1, name: "A", price: 10 },
      { id: 1, name: "A again", price: 10 },
      { name: "No id", price: 5 },
      { id: 3, price: 5 },
      { id: 4, name: "Bad price", price: "free" },
    ];
    const result = normalizeItems(payload, detectMapping(payload), "minor");
    expect(result.products.map((product) => product.externalId)).toEqual(["1"]);
    expect(result.products[0]!.priceMinor).toBe(10);
    expect(result.skipped).toHaveLength(4);
  });
});

describe("auto-entry sync", () => {
  beforeEach(async () => {
    await prisma.productSource.create({
      data: { storeId: fx.storeA.id, mode: "api", apiUrl: "https://api.example.test/products", autoSync: true },
    });
  });

  it("imports into the main product list, updates on resync, and hides products that disappear", async () => {
    stubFeed(feed([
      { id: "p1", title: "Desk Lamp", price: 1200, category: "Home", stock: 4 },
      { id: "p2", title: "Desk Lamp", price: 800, category: "Home", stock: 0 },
    ]));
    expect(await syncProductSource(fx.storeA.id)).toMatchObject({ created: 2, updated: 0, deactivated: 0 });

    const imported = await prisma.product.findMany({ where: { storeId: fx.storeA.id, sourceType: "api" }, include: { variants: true } });
    expect(imported).toHaveLength(2);
    expect(new Set(imported.map((product) => product.slug)).size).toBe(2); // same name, unique slugs
    expect(imported.find((product) => product.externalProductId === "p2")!.variants[0]!.stockStatus).toBe("out_of_stock");

    stubFeed(feed([{ id: "p1", title: "Desk Lamp Pro", price: 1500, category: "Home", stock: 2 }]));
    expect(await syncProductSource(fx.storeA.id)).toMatchObject({ created: 0, updated: 1, deactivated: 1 });
    const p1 = await prisma.product.findFirstOrThrow({ where: { externalProductId: "p1" } });
    expect(p1).toMatchObject({ name: "Desk Lamp Pro", priceMinor: 150000, status: "active" });
    expect((await prisma.product.findFirstOrThrow({ where: { externalProductId: "p2" } })).status).toBe("inactive");

    // Manually managed products are never touched by the sync.
    expect((await prisma.product.findUniqueOrThrow({ where: { id: fx.products.tote.id } })).status).toBe("active");
  });

  it("records a failure without changing the catalog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(syncProductSource(fx.storeA.id)).rejects.toThrow(/HTTP 500/);
    const source = await prisma.productSource.findUniqueOrThrow({ where: { storeId: fx.storeA.id } });
    expect(source).toMatchObject({ lastStatus: "error", syncLockedUntil: null });
    expect(await prisma.product.count({ where: { sourceType: "api" } })).toBe(0);
  });

  it("does not run two syncs at once", async () => {
    await prisma.productSource.update({
      where: { storeId: fx.storeA.id },
      data: { syncLockedUntil: new Date(Date.now() + 60_000) },
    });
    await expect(syncProductSource(fx.storeA.id)).rejects.toThrow(/already running/);
  });
});

describe("uploads", () => {
  it("rejects disallowed types and only lets the uploading session attach a file", async () => {
    const owner = await newSession();
    const other = await newSession();
    await expect(
      saveUpload({ storeId: owner.storeId, sessionId: owner.sessionId, file: new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }) }),
    ).rejects.toBeInstanceOf(UploadError);

    const upload = await saveUpload({
      storeId: owner.storeId,
      sessionId: owner.sessionId,
      file: new File([new Uint8Array([1, 2, 3])], "note.webm", { type: "audio/webm;codecs=opus" }),
    });
    expect(upload).toMatchObject({ kind: "audio", mime: "audio/webm", size: 3 });

    const stolen = await claimUploads({
      storeId: other.storeId,
      sessionId: other.sessionId,
      conversationId: other.conversationId,
      items: [{ uploadId: upload.id }],
    });
    expect(stolen).toEqual([]);

    const claimed = await claimUploads({
      storeId: owner.storeId,
      sessionId: owner.sessionId,
      conversationId: owner.conversationId,
      items: [{ uploadId: upload.id, transcript: "  do you have it in black  ", durationMs: 3200 }],
    });
    expect(claimed[0]).toMatchObject({ kind: "audio", transcript: "do you have it in black", durationMs: 3200 });
    // Already attached: can't be reused on another message.
    expect(
      await claimUploads({ storeId: owner.storeId, sessionId: owner.sessionId, conversationId: owner.conversationId, items: [{ uploadId: upload.id }] }),
    ).toEqual([]);
  });
});
