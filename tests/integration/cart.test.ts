import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { CartError, addItem, getCartSummary, removeItem, updateItem } from "@/modules/cart/cart.service";
import { getSessionContext } from "@/modules/conversations/session.service";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

function add(session: Awaited<ReturnType<typeof newSession>>, productId: string, variantId: string | null, quantity: number) {
  return addItem({
    sessionId: session.sessionId,
    storeId: session.storeId,
    currency: session.store.currency,
    productId,
    variantId,
    quantity,
  });
}

async function expectCartError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(CartError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe("cart service", () => {
  it("adds, merges, updates, and removes lines with server-side totals", async () => {
    const s = await newSession();
    await add(s, fx.products.backpack.id, fx.variants.backpackBlack.id, 2);
    let cart = await add(s, fx.products.backpack.id, fx.variants.backpackBlack.id, 1);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]!.quantity).toBe(3);

    cart = await add(s, fx.products.tote.id, null, 1); // single variant is auto-selected
    expect(cart.items).toHaveLength(2);
    expect(cart.subtotalMinor).toBe(3 * 250000 + 120000);

    const backpackLine = cart.items.find((i) => i.productId === fx.products.backpack.id)!;
    cart = await updateItem({ sessionId: s.sessionId, storeId: s.storeId, cartId: cart.cartId, itemId: backpackLine.itemId, quantity: 1 });
    expect(cart.subtotalMinor).toBe(250000 + 120000);

    cart = await removeItem({ sessionId: s.sessionId, storeId: s.storeId, cartId: cart.cartId, itemId: backpackLine.itemId });
    expect(cart.items.map((i) => i.productId)).toEqual([fx.products.tote.id]);
    expect(cart.subtotalMinor).toBe(120000);
    expect(cart.itemCount).toBe(1);
  });

  it("persists the cart across a reload of the same session", async () => {
    const s = await newSession();
    await add(s, fx.products.scarf.id, null, 2);
    const reloaded = await getSessionContext(s.sessionId);
    const cart = await getCartSummary(reloaded!.sessionId, reloaded!.storeId, "BDT");
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]!.quantity).toBe(2);
  });

  it("recalculates totals from current prices, not the snapshot", async () => {
    const s = await newSession();
    await add(s, fx.products.scarf.id, null, 2);
    await prisma.product.update({ where: { id: fx.products.scarf.id }, data: { priceMinor: 100000 } });
    const cart = await getCartSummary(s.sessionId, s.storeId, "BDT");
    expect(cart.subtotalMinor).toBe(200000);
  });

  it("rejects invalid quantities, sold-out variants, and stock overflow", async () => {
    const s = await newSession();
    await expectCartError(add(s, fx.products.tote.id, null, 0), "invalid_quantity");
    await expectCartError(add(s, fx.products.tote.id, null, 100), "invalid_quantity");
    await expectCartError(add(s, fx.products.tote.id, null, 1.5), "invalid_quantity");
    await expectCartError(add(s, fx.products.backpack.id, fx.variants.backpackRed.id, 1), "variant_unavailable");
    await expectCartError(add(s, fx.products.backpack.id, fx.variants.backpackOlive.id, 4), "insufficient_stock");
  });

  it("requires a variant choice when a product has several", async () => {
    const s = await newSession();
    const promise = add(s, fx.products.backpack.id, null, 1);
    await expectCartError(promise, "variant_required");
  });

  it("rejects a variant that belongs to a different product", async () => {
    const s = await newSession();
    await expectCartError(add(s, fx.products.tote.id, fx.variants.backpackBlack.id, 1), "variant_not_found");
  });

  it("refuses inactive products and products from another store", async () => {
    const s = await newSession();
    await expectCartError(add(s, fx.products.retired.id, null, 1), "product_not_found");
    await expectCartError(add(s, fx.products.foreign.id, null, 1), "product_not_found");
  });

  it("prevents one session from reading or changing another session's cart", async () => {
    const owner = await newSession();
    const intruder = await newSession();
    const ownerCart = await add(owner, fx.products.scarf.id, null, 1);
    const itemId = ownerCart.items[0]!.itemId;

    await expectCartError(
      updateItem({ sessionId: intruder.sessionId, storeId: intruder.storeId, cartId: ownerCart.cartId, itemId, quantity: 5 }),
      "cart_not_found",
    );
    await expectCartError(
      removeItem({ sessionId: intruder.sessionId, storeId: intruder.storeId, cartId: ownerCart.cartId, itemId }),
      "cart_not_found",
    );

    const intruderCart = await getCartSummary(intruder.sessionId, intruder.storeId, "BDT");
    expect(intruderCart.items).toEqual([]);
    const untouched = await getCartSummary(owner.sessionId, owner.storeId, "BDT");
    expect(untouched.items[0]!.quantity).toBe(1);
  });
});
