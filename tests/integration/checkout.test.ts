import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { addItem } from "@/modules/cart/cart.service";
import { CheckoutError, prepareCheckoutForSession } from "@/modules/commerce/checkout.service";
import { UntrustedCheckoutUrlError } from "@/modules/commerce/checkout-url";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

async function sessionWithCart() {
  const s = await newSession();
  const base = { sessionId: s.sessionId, storeId: s.storeId, currency: "BDT" };
  await addItem({ ...base, productId: fx.products.backpack.id, variantId: fx.variants.backpackOlive.id, quantity: 2 });
  await addItem({ ...base, productId: fx.products.scarf.id, quantity: 1 });
  return s;
}

describe("checkout preparation", () => {
  it("refuses an empty cart", async () => {
    const s = await newSession();
    await expect(prepareCheckoutForSession({ sessionId: s.sessionId, store: s.store })).rejects.toMatchObject({
      code: "cart_empty",
    });
  });

  it("produces a trusted URL whose lines match the cart exactly", async () => {
    const s = await sessionWithCart();
    const prepared = await prepareCheckoutForSession({ sessionId: s.sessionId, store: s.store });

    expect(new URL(prepared.checkoutUrl).host).toBe("localhost:3000");
    const saved = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: prepared.checkoutSessionId } });
    expect(saved.status).toBe("prepared");
    expect(saved.subtotalMinor).toBe(2 * 270000 + 95000);

    const lines = JSON.parse(saved.lines) as Array<{ sku: string | null; quantity: number; unitPriceMinor: number }>;
    expect(lines.map((l) => [l.sku, l.quantity, l.unitPriceMinor])).toEqual([
      ["TB-OLV", 2, 270000],
      [null, 1, 95000],
    ]);
  });

  it("is idempotent for an unchanged cart", async () => {
    const s = await sessionWithCart();
    const first = await prepareCheckoutForSession({ sessionId: s.sessionId, store: s.store });
    const second = await prepareCheckoutForSession({ sessionId: s.sessionId, store: s.store });
    expect(second.checkoutSessionId).toBe(first.checkoutSessionId);
    expect(second.checkoutUrl).toBe(first.checkoutUrl);
    expect(await prisma.checkoutSession.count()).toBe(1);
  });

  it("expires the old handoff when the cart changes", async () => {
    const s = await sessionWithCart();
    const first = await prepareCheckoutForSession({ sessionId: s.sessionId, store: s.store });
    await addItem({ sessionId: s.sessionId, storeId: s.storeId, currency: "BDT", productId: fx.products.tote.id, quantity: 1 });
    const second = await prepareCheckoutForSession({ sessionId: s.sessionId, store: s.store });

    expect(second.checkoutSessionId).not.toBe(first.checkoutSessionId);
    const old = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: first.checkoutSessionId } });
    expect(old.status).toBe("expired");
  });

  it("uses the current price when the catalog price changed after adding", async () => {
    const s = await sessionWithCart();
    await prisma.product.update({ where: { id: fx.products.scarf.id }, data: { priceMinor: 99000 } });
    const prepared = await prepareCheckoutForSession({ sessionId: s.sessionId, store: s.store });
    const saved = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: prepared.checkoutSessionId } });
    expect(saved.subtotalMinor).toBe(2 * 270000 + 99000);
  });

  it.each([
    ["sold out", { stockStatus: "out_of_stock" }],
    ["stock dropped below the cart quantity", { stockQuantity: 1 }],
  ])("refuses checkout when a variant is %s", async (_label, change) => {
    const s = await sessionWithCart();
    await prisma.productVariant.update({ where: { id: fx.variants.backpackOlive.id }, data: change });

    const attempt = prepareCheckoutForSession({ sessionId: s.sessionId, store: s.store });
    await expect(attempt).rejects.toBeInstanceOf(CheckoutError);
    await expect(attempt).rejects.toMatchObject({ code: "cart_invalid" });
    expect(await prisma.checkoutSession.count()).toBe(0);
  });

  it("refuses checkout when a product was deactivated", async () => {
    const s = await sessionWithCart();
    await prisma.product.update({ where: { id: fx.products.scarf.id }, data: { status: "inactive" } });
    await expect(prepareCheckoutForSession({ sessionId: s.sessionId, store: s.store })).rejects.toMatchObject({
      code: "cart_invalid",
    });
  });

  it("refuses to hand off a stored URL that is no longer on a trusted host", async () => {
    const s = await sessionWithCart();
    const first = await prepareCheckoutForSession({ sessionId: s.sessionId, store: s.store });
    await prisma.checkoutSession.update({
      where: { id: first.checkoutSessionId },
      data: { checkoutUrl: "https://evil.example/checkout/x" },
    });
    await expect(prepareCheckoutForSession({ sessionId: s.sessionId, store: s.store })).rejects.toBeInstanceOf(
      UntrustedCheckoutUrlError,
    );
  });
});
