import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { addItem } from "@/modules/cart/cart.service";
import { prepareCheckoutForSession } from "@/modules/commerce/checkout.service";
import {
  OrderError,
  findOrdersForCustomer,
  placeOrderFromCheckout,
  updateOrderStatus,
} from "@/modules/orders/order.service";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;

const customer = { name: "Rahim Uddin", phone: "+880 1712-345678", email: "", address: "House 4, Road 2, Dhanmondi", city: "Dhaka", notes: "" };

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
  await prisma.store.update({
    where: { id: fx.storeA.id },
    data: {
      shippingZones: JSON.stringify([
        { id: "dhaka", label: "Inside Dhaka", feeMinor: 8000 },
        { id: "outside", label: "Outside Dhaka", feeMinor: 15000 },
      ]),
      freeShippingOverMinor: 300000,
      codEnabled: true,
    },
  });
});

async function checkoutWith(lines: Array<{ productId: string; variantId?: string; quantity: number }>) {
  const session = await newSession();
  for (const line of lines) {
    await addItem({ sessionId: session.sessionId, storeId: session.storeId, currency: "BDT", ...line });
  }
  const store = await prisma.store.findUniqueOrThrow({ where: { id: session.storeId } });
  const prepared = await prepareCheckoutForSession({ sessionId: session.sessionId, store });
  const token = prepared.checkoutUrl.split("/checkout/")[1]!;
  return { session, token };
}

describe("placing an order", () => {
  it("creates the order, reserves stock, closes the cart and tells the chat", async () => {
    const { session, token } = await checkoutWith([{ productId: fx.products.backpack.id, variantId: fx.variants.backpackBlack.id, quantity: 2 }]);
    const order = await placeOrderFromCheckout({ token, customer, shippingZoneId: "dhaka", paymentMethod: "cod" });

    expect(order.orderNumber).toMatch(/^NB-[A-Z2-9]{6}$/);
    expect(order).toMatchObject({ subtotalMinor: 500000, shippingMinor: 0, totalMinor: 500000, status: "placed", paymentStatus: "pending" });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: fx.variants.backpackBlack.id } })).stockQuantity).toBe(3);

    const cart = await prisma.cart.findFirstOrThrow({ where: { sessionId: session.sessionId } });
    expect(cart.status).toBe("checked_out");
    const event = await prisma.message.findFirst({ where: { conversationId: session.conversationId, role: "event" } });
    expect(event?.content).toContain(order.orderNumber);
  });

  it("charges the zone fee below the free-delivery threshold", async () => {
    const { token } = await checkoutWith([{ productId: fx.products.scarf.id, quantity: 1 }]);
    const order = await placeOrderFromCheckout({ token, customer, shippingZoneId: "outside", paymentMethod: "cod" });
    expect(order).toMatchObject({ subtotalMinor: 95000, shippingMinor: 15000, totalMinor: 110000, shippingZone: "Outside Dhaka" });
  });

  it("returns the same order on a double submit instead of creating two", async () => {
    const { token } = await checkoutWith([{ productId: fx.products.scarf.id, quantity: 1 }]);
    const first = await placeOrderFromCheckout({ token, customer, shippingZoneId: "dhaka", paymentMethod: "cod" });
    const second = await placeOrderFromCheckout({ token, customer, shippingZoneId: "dhaka", paymentMethod: "cod" });
    expect(second.id).toBe(first.id);
    expect(await prisma.order.count()).toBe(1);
  });

  it("refuses when the price changed after the customer reviewed it", async () => {
    const { token } = await checkoutWith([{ productId: fx.products.scarf.id, quantity: 1 }]);
    await prisma.product.update({ where: { id: fx.products.scarf.id }, data: { priceMinor: 99000 } });
    const attempt = placeOrderFromCheckout({ token, customer, shippingZoneId: "dhaka", paymentMethod: "cod" });
    await expect(attempt).rejects.toMatchObject({ code: "cart_changed" });
    expect(await prisma.order.count()).toBe(0);
  });

  it("lets only one buyer take the last unit", async () => {
    await prisma.productVariant.update({ where: { id: fx.variants.backpackOlive.id }, data: { stockQuantity: 1 } });
    const a = await checkoutWith([{ productId: fx.products.backpack.id, variantId: fx.variants.backpackOlive.id, quantity: 1 }]);
    const b = await checkoutWith([{ productId: fx.products.backpack.id, variantId: fx.variants.backpackOlive.id, quantity: 1 }]);

    const results = await Promise.allSettled([
      placeOrderFromCheckout({ token: a.token, customer, shippingZoneId: "dhaka", paymentMethod: "cod" }),
      placeOrderFromCheckout({ token: b.token, customer, shippingZoneId: "dhaka", paymentMethod: "cod" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: fx.variants.backpackOlive.id } })).stockQuantity).toBe(0);
    expect(await prisma.order.count()).toBe(1);
  });

  it("rejects unavailable payment methods and unknown delivery areas", async () => {
    const { token } = await checkoutWith([{ productId: fx.products.scarf.id, quantity: 1 }]);
    await expect(placeOrderFromCheckout({ token, customer, shippingZoneId: "dhaka", paymentMethod: "online" })).rejects.toMatchObject({
      code: "payment_unavailable",
    });
    await expect(placeOrderFromCheckout({ token, customer, shippingZoneId: "mars", paymentMethod: "cod" })).rejects.toBeInstanceOf(OrderError);
    await prisma.store.update({ where: { id: fx.storeA.id }, data: { codEnabled: false } });
    await expect(placeOrderFromCheckout({ token, customer, shippingZoneId: "dhaka", paymentMethod: "cod" })).rejects.toMatchObject({
      code: "payment_unavailable",
    });
  });
});

describe("order status", () => {
  it("follows allowed transitions, releases stock on cancel, and posts updates to the chat", async () => {
    const { session, token } = await checkoutWith([{ productId: fx.products.backpack.id, variantId: fx.variants.backpackBlack.id, quantity: 2 }]);
    const order = await placeOrderFromCheckout({ token, customer, shippingZoneId: "dhaka", paymentMethod: "cod" });

    await expect(updateOrderStatus({ storeId: fx.storeA.id, orderId: order.id, status: "delivered", by: "test" })).rejects.toMatchObject({
      code: "invalid_transition",
    });

    await updateOrderStatus({ storeId: fx.storeA.id, orderId: order.id, status: "cancelled", note: "Customer request", by: "test" });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: fx.variants.backpackBlack.id } })).stockQuantity).toBe(5);
    const events = await prisma.message.findMany({ where: { conversationId: session.conversationId, role: "event" } });
    expect(events.some((event) => event.content.includes("Cancelled"))).toBe(true);
  });

  it("marks cash-on-delivery orders paid when delivered", async () => {
    const { token } = await checkoutWith([{ productId: fx.products.scarf.id, quantity: 1 }]);
    const order = await placeOrderFromCheckout({ token, customer, shippingZoneId: "dhaka", paymentMethod: "cod" });
    for (const status of ["confirmed", "processing", "shipped", "delivered"] as const) {
      await updateOrderStatus({ storeId: fx.storeA.id, orderId: order.id, status, by: "test" });
    }
    const delivered = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(delivered.paymentStatus).toBe("paid");
    expect(delivered.statusHistory.map((event) => event.status)).toEqual(["placed", "confirmed", "processing", "shipped", "delivered"]);
  });

  it("shows another chat's order only with the matching phone number", async () => {
    const { token } = await checkoutWith([{ productId: fx.products.scarf.id, quantity: 1 }]);
    const order = await placeOrderFromCheckout({ token, customer, shippingZoneId: "dhaka", paymentMethod: "cod" });
    const stranger = await newSession();

    const noPhone = await findOrdersForCustomer({ storeId: fx.storeA.id, sessionId: stranger.sessionId, orderNumber: order.orderNumber });
    expect(noPhone).toEqual({ orders: [], verified: false });
    const wrongPhone = await findOrdersForCustomer({
      storeId: fx.storeA.id,
      sessionId: stranger.sessionId,
      orderNumber: order.orderNumber,
      phone: "01999999999",
    });
    expect(wrongPhone.orders).toEqual([]);
    const ok = await findOrdersForCustomer({
      storeId: fx.storeA.id,
      sessionId: stranger.sessionId,
      orderNumber: order.orderNumber.toLowerCase(),
      phone: "01712345678",
    });
    expect(ok.orders.map((entry) => entry.id)).toEqual([order.id]);
  });
});
