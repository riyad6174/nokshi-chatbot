import { beforeEach, describe, expect, it } from "vitest";
import { executeTool } from "@/modules/ai/tools";
import { addItem, getCartSummary } from "@/modules/cart/cart.service";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;
beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

async function cartWith(...items: Array<{ productId: string; variantId?: string; quantity?: number }>) {
  const session = await newSession();
  for (const item of items) {
    await addItem({ sessionId: session.sessionId, storeId: session.storeId, currency: "BDT", productId: item.productId, variantId: item.variantId ?? null, quantity: item.quantity ?? 1 });
  }
  return session;
}
const lines = async (session: Awaited<ReturnType<typeof newSession>>) =>
  (await getCartSummary(session.sessionId, session.storeId, "BDT")).items.map((item) => `${item.name} x${item.quantity}`);

describe("changing the cart by product name (no fragile ids)", () => {
  it("removes a line by its product name", async () => {
    const session = await cartWith({ productId: fx.products.backpack.id, variantId: fx.variants.backpackOlive.id }, { productId: fx.products.scarf.id });
    const result = await executeTool({ session }, "remove_cart_item", JSON.stringify({ product: "Trail Backpack" }));
    expect(result.ok, JSON.stringify(result.content)).toBe(true);
    expect(await lines(session)).toEqual(["Handloom Scarf x1"]);
  });

  it("with one line in the cart, a mistyped id still removes it", async () => {
    const session = await cartWith({ productId: fx.products.scarf.id });
    const result = await executeTool({ session }, "remove_cart_item", JSON.stringify({ itemId: "not-a-real-id" }));
    expect(result.ok).toBe(true);
    expect(await lines(session)).toEqual([]);
  });

  it("changes the quantity by product name", async () => {
    const session = await cartWith({ productId: fx.products.backpack.id, variantId: fx.variants.backpackOlive.id }, { productId: fx.products.scarf.id });
    const result = await executeTool({ session }, "update_cart_item", JSON.stringify({ product: "backpack", quantity: 2 }));
    expect(result.ok, JSON.stringify(result.content)).toBe(true);
    expect(await lines(session)).toContain("Trail Backpack x2");
  });

  it("says plainly when the item isn't in the cart", async () => {
    const session = await cartWith({ productId: fx.products.backpack.id, variantId: fx.variants.backpackOlive.id }, { productId: fx.products.scarf.id });
    const result = await executeTool({ session }, "remove_cart_item", JSON.stringify({ product: "Laptop" }));
    expect((result.content as { error: { code: string } }).error.code).toBe("item_not_found");
  });
});
