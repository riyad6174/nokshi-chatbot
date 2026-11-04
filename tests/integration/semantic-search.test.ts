import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { executeTool } from "@/modules/ai/tools";
import { searchKnowledge } from "@/modules/knowledge/retrieval.service";
import { refreshKnowledgeEmbeddings, refreshProductEmbeddings } from "@/modules/search/embeddings.service";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

// A fake embeddings API: each text becomes a vector over a few concepts, so "carryall" lands near
// "backpack" without sharing a word, as a real multilingual embedding model would place them.
const CONCEPTS: string[][] = [
  ["backpack", "bag", "carryall", "rucksack", "tote", "ব্যাগ", "school"],
  ["scarf", "shawl", "wrap", "neck"],
  ["delivery", "shipping", "arrive", "দিন", "courier"],
];
function fakeVector(text: string): number[] {
  const lower = text.toLowerCase();
  return CONCEPTS.map((words) => words.filter((word) => lower.includes(word)).length + 0.01);
}

let fx: Fixture;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fetchSpy: any;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
  process.env.EMBEDDINGS_PROVIDER = "openai-compatible";
  process.env.EMBEDDINGS_BASE_URL = "http://embeddings.test/v1";
  process.env.SEMANTIC_MIN_SCORE = "0.8";
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (!String(url).startsWith("http://embeddings.test")) throw new Error(`unexpected fetch ${String(url)}`);
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    return new Response(JSON.stringify({ data: body.input.map((text, index) => ({ index, embedding: fakeVector(text) })) }), { status: 200 });
  });
});

afterEach(() => {
  fetchSpy.mockRestore();
  delete process.env.EMBEDDINGS_PROVIDER;
  delete process.env.EMBEDDINGS_BASE_URL;
  delete process.env.SEMANTIC_MIN_SCORE;
});

describe("semantic product search", () => {
  it("embeds changed products once and finds them by meaning", async () => {
    expect(await refreshProductEmbeddings(fx.storeA.id)).toBeGreaterThan(0);
    expect(await refreshProductEmbeddings(fx.storeA.id)).toBe(0); // unchanged text: no new calls

    const session = await newSession();
    const result = await executeTool({ session }, "search_products", JSON.stringify({ query: "a carryall for school" }));
    const names = (result.content as { products: Array<{ name: string }> }).products.map((product) => product.name);
    expect(names).toEqual(expect.arrayContaining(["Trail Backpack"]));
    expect(names).not.toContain("Foreign Backpack");
    expect(names).not.toContain("Retired Backpack");
  });

  it("keeps working on keywords when the embeddings API is down", async () => {
    fetchSpy.mockImplementation(async () => new Response("down", { status: 503 }));
    const session = await newSession();
    const result = await executeTool({ session }, "search_products", JSON.stringify({ query: "tote" }));
    expect((result.content as { products: Array<{ name: string }> }).products.map((product) => product.name)).toContain("Canvas Tote");
  });
});

describe("knowledge retrieval", () => {
  it("matches policy synonyms and Bangla without the exact words", async () => {
    await prisma.knowledgeDocument.create({
      data: { storeId: fx.storeA.id, title: "Returns & refunds", content: "You can return any unused item within 7 days for a full refund.\n\nRefunds are sent by bKash.", contentHash: "r" },
    });
    const hits = await searchKnowledge(fx.storeA.id, "can I get my money back?", 3, { semantic: false });
    expect(hits[0]?.title).toBe("Returns & refunds");
    const bangla = await searchKnowledge(fx.storeA.id, "ফেরত দিতে পারব?", 3, { semantic: false });
    expect(bangla[0]?.title).toBe("Returns & refunds");
    // Store B's documents never leak into store A's results.
    expect((await searchKnowledge(fx.storeA.id, "drone", 3)).length).toBe(0);
  });

  it("uses embeddings to rank the right document", async () => {
    await refreshKnowledgeEmbeddings(fx.storeA.id);
    const hits = await searchKnowledge(fx.storeA.id, "when will my parcel arrive by courier");
    expect(hits[0]?.title).toBe("Shipping & Delivery");
  });
});
