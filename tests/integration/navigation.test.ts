import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { executeTool } from "@/modules/ai/tools";
import { addItem } from "@/modules/cart/cart.service";
import type { ChatPart } from "@/types/chat";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

const navigation = (ui: ChatPart[] | undefined) =>
  (ui ?? []).find((part): part is Extract<ChatPart, { type: "navigate" }> => part.type === "navigate");

describe("taking the customer to a page", () => {
  it("opens a product page by name", async () => {
    const session = await newSession();
    const result = await executeTool({ session }, "open_product_page", JSON.stringify({ product: "trail backpack" }));
    expect(navigation(result.ui)?.url).toBe("/products/trail-backpack");
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
