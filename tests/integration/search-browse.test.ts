import { beforeEach, describe, expect, it } from "vitest";
import { executeTool } from "@/modules/ai/tools";
import type { ChatPart } from "@/types/chat";
import { newSession, resetDb, seedFixture } from "../helpers/fixtures";

beforeEach(async () => {
  await resetDb();
  await seedFixture();
});

type SearchContent = { matched: boolean; count: number; note: string; storeCategories: string[] };

async function search(args: Record<string, unknown>) {
  const session = await newSession();
  const result = await executeTool({ session }, "search_products", JSON.stringify(args));
  const list = (result.ui ?? []).find((part): part is Extract<ChatPart, { type: "product_list" }> => part.type === "product_list");
  return { content: result.content as SearchContent, list };
}

describe("product search never leaves the customer with nothing", () => {
  it("shows a selection across categories for 'what products do you have?'", async () => {
    for (const query of ["products", "আপনাদের কাছে কি কি প্রোডাক্ট আছে?", "what do you have"]) {
      const { content, list } = await search({ query });
      expect(list?.label).toBe("Our products");
      expect(content.count).toBeGreaterThanOrEqual(2);
      expect(new Set(list!.products.map((product) => product.category))).toEqual(new Set(["Bags", "Accessories"]));
    }
    const { list } = await search({});
    expect(list?.products.length).toBeGreaterThanOrEqual(3);
  });

  it("finds bags however they're asked for", async () => {
    for (const query of ["bag", "bags", "ব্যাগ", "ব্যাগ দেখান"]) {
      const { content, list } = await search({ query });
      expect(content.matched).toBe(true);
      expect(list!.products.every((product) => product.category === "Bags")).toBe(true);
    }
  });

  it("offers what the store has when asked for something it doesn't sell", async () => {
    const { content, list } = await search({ query: "জুতা" });
    expect(content.matched).toBe(false);
    expect(list?.label).toBe("You might like");
    expect(content.note).toContain("doesn't have that");
  });
});
