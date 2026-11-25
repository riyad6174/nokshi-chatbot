import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { executeTool } from "@/modules/ai/tools";
import { addItem } from "@/modules/cart/cart.service";
import { appendMessage } from "@/modules/conversations/conversation.service";
import type { ChatPart } from "@/types/chat";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

const errorCode = (content: unknown) => (content as { error?: { code: string } }).error?.code;

/** Saves an assistant reply that showed these products as cards (only what the tools read). */
async function showCards(conversationId: string, products: Array<{ id: string; name: string; slug: string }>) {
  await appendMessage({
    conversationId,
    role: "assistant",
    content: "",
    parts: [{ type: "product_list", products: products as never, label: "Products" }],
  });
}

const navigation = (ui: ChatPart[] | undefined) =>
  (ui ?? []).find((part): part is Extract<ChatPart, { type: "navigate" }> => part.type === "navigate");

describe("taking the customer to a page", () => {
  it("opens a product page by name", async () => {
    const session = await newSession();
    const result = await executeTool({ session }, "open_product_page", JSON.stringify({ product: "trail backpack" }));
    expect(navigation(result.ui)?.url).toBe("/products/trail-backpack");
  });

  it("opens only the page: no card comes with it", async () => {
    const session = await newSession();
    const result = await executeTool({ session }, "open_product_page", JSON.stringify({ product: "Trail Backpack" }));
    expect(result.ui?.map((part) => part.type)).toEqual(["navigate"]);
  });

  it("opens a product by its number on screen", async () => {
    const session = await newSession();
    await showCards(session.conversationId, [fx.products.tote, fx.products.backpack, fx.products.scarf]);
    const result = await executeTool({ session }, "open_product_page", JSON.stringify({ position: 2 }));
    expect(navigation(result.ui)?.url).toBe("/products/trail-backpack");
  });

  it("finds 'number 2' in a list shown earlier in the same reply, before it's saved", async () => {
    const session = await newSession();
    const shownThisTurn = [{ type: "product_list", products: [fx.products.tote, fx.products.backpack], label: "Bags" }] as unknown as ChatPart[];
    const page = await executeTool({ session, shownThisTurn }, "open_product_page", JSON.stringify({ position: 2 }));
    expect(navigation(page.ui)?.url).toBe("/products/trail-backpack");
    const added = await executeTool({ session, shownThisTurn }, "add_to_cart", JSON.stringify({ position: 1 }));
    expect(added.ok, JSON.stringify(added.content)).toBe(true);
  });

  it("understands a Bangla product name", async () => {
    const session = await newSession();
    const result = await executeTool({ session }, "open_product_page", JSON.stringify({ product: "ব্যাকপ্যাক" }));
    expect(navigation(result.ui)?.url).toBe("/products/trail-backpack");
  });

  it("asks which one when a name fits several products, listing them", async () => {
    const session = await newSession();
    const result = await executeTool({ session }, "open_product_page", JSON.stringify({ product: "ব্যাগ" }));
    expect(errorCode(result.content)).toBe("ambiguous_product");
    const message = (result.content as { error: { message: string } }).error.message;
    expect(message).toContain("Trail Backpack");
    expect(message).toContain("Canvas Tote");
  });

  it("opens the product being talked about", async () => {
    const session = await newSession();
    // "Tell me about the tote" showed its single card; "open its page" names nothing.
    await showCards(session.conversationId, [fx.products.tote]);
    const result = await executeTool({ session }, "open_product_page", "{}");
    expect(navigation(result.ui)?.url).toBe("/products/canvas-tote");
    // "the bag" fits two products, but the one being talked about wins.
    const bag = await executeTool({ session }, "open_product_page", JSON.stringify({ product: "ব্যাগ" }));
    expect(navigation(bag.ui)?.url).toBe("/products/canvas-tote");
  });

  it("refuses a product that isn't sold here", async () => {
    const session = await newSession();
    const result = await executeTool({ session }, "open_product_page", JSON.stringify({ product: "Foreign Backpack" }));
    expect((result.content as { error: { code: string } }).error.code).toBe("product_not_found");
  });

  it("opens checkout pre-filled with the details the customer gave before", async () => {
    const session = await newSession();
    await addItem({ sessionId: session.sessionId, storeId: session.storeId, currency: "BDT", productId: fx.products.scarf.id, quantity: 1 });
    await prisma.customerProfile.create({
      data: {
        storeId: fx.storeA.id,
        visitorIds: [session.visitorId],
        interests: [],
        name: "Imran Hossain",
        phone: "01794283380",
        address: "Parbatipur, Dinajpur",
      },
    });
    const result = await executeTool({ session }, "go_to_checkout", "{}");
    const url = navigation(result.ui)?.url ?? "";
    expect(url).toMatch(/^\/checkout\/[\w-]+$/);
    const checkout = await prisma.checkoutSession.findFirstOrThrow({ where: { token: url.split("/").pop() } });
    expect(checkout.customer).toMatchObject({ name: "Imran Hossain", phone: "01794283380", address: "Parbatipur, Dinajpur" });
  });

  it("says the cart is empty instead of opening an empty checkout", async () => {
    const session = await newSession();
    const result = await executeTool({ session }, "go_to_checkout", "{}");
    expect((result.content as { error: { code: string } }).error.code).toBe("cart_empty");
  });
});
