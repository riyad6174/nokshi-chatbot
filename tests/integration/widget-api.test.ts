import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as createSessionRoute } from "@/app/api/widget/session/route";
import { POST as addItemRoute } from "@/app/api/widget/cart/items/route";
import { DELETE as deleteItemRoute, PATCH as patchItemRoute } from "@/app/api/widget/cart/items/[itemId]/route";
import { POST as checkoutRoute } from "@/app/api/widget/checkout/route";
import { POST as messageRoute } from "@/app/api/widget/message/route";
import { WIDGET_COOKIE } from "@/lib/auth/widget";
import { resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;
let ipCounter = 0;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

function request(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  // A fresh IP per request keeps the in-memory IP rate limiter out of the way.
  ipCounter += 1;
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
      ...(init.cookie ? { cookie: `${WIDGET_COOKIE}=${init.cookie}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function openSession(widgetKey = "key-a") {
  const response = await createSessionRoute(request("/api/widget/session", { body: { widgetKey } }));
  expect(response.status).toBe(200);
  const cookie = response.cookies.get(WIDGET_COOKIE)?.value;
  expect(cookie).toBeTruthy();
  const body = await response.json();
  return { cookie: cookie!, body };
}

const params = (itemId: string) => ({ params: Promise.resolve({ itemId }) });

describe("widget session API", () => {
  it("rejects unknown widget keys", async () => {
    const response = await createSessionRoute(request("/api/widget/session", { body: { widgetKey: "nope" } }));
    expect(response.status).toBe(404);
  });

  it("resumes the same session and cart when the cookie is sent back", async () => {
    const first = await openSession();
    await addItemRoute(request("/api/widget/cart/items", { cookie: first.cookie, body: { productId: fx.products.scarf.id } }));

    const resumed = await createSessionRoute(
      request("/api/widget/session", { cookie: first.cookie, body: { widgetKey: "key-a" } }),
    );
    const body = await resumed.json();
    expect(body.sessionId).toBe(first.body.sessionId);
    expect(body.cart.items).toHaveLength(1);
  });

  it("does not let a store A cookie open a store B session", async () => {
    const a = await openSession("key-a");
    const response = await createSessionRoute(
      request("/api/widget/session", { cookie: a.cookie, body: { widgetKey: "key-b" } }),
    );
    const body = await response.json();
    expect(body.sessionId).not.toBe(a.body.sessionId);
    expect(body.store.name).toBe("Store B");
  });
});

describe("widget cart API", () => {
  it("requires a valid session cookie", async () => {
    const noCookie = await addItemRoute(request("/api/widget/cart/items", { body: { productId: fx.products.scarf.id } }));
    expect(noCookie.status).toBe(401);
    const forged = await addItemRoute(
      request("/api/widget/cart/items", { cookie: "forged.value", body: { productId: fx.products.scarf.id } }),
    );
    expect(forged.status).toBe(401);
  });

  it("validates request bodies", async () => {
    const { cookie } = await openSession();
    const response = await addItemRoute(
      request("/api/widget/cart/items", { cookie, body: { productId: fx.products.scarf.id, quantity: "lots" } }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
  });

  it("returns 404 when a visitor targets another visitor's cart item", async () => {
    const owner = await openSession();
    const intruder = await openSession();
    const added = await addItemRoute(
      request("/api/widget/cart/items", { cookie: owner.cookie, body: { productId: fx.products.scarf.id } }),
    );
    const itemId = (await added.json()).cart.items[0].itemId as string;

    const patch = await patchItemRoute(
      request(`/api/widget/cart/items/${itemId}`, { method: "PATCH", cookie: intruder.cookie, body: { quantity: 9 } }),
      params(itemId),
    );
    expect(patch?.status).toBe(404);
    const del = await deleteItemRoute(
      request(`/api/widget/cart/items/${itemId}`, { method: "DELETE", cookie: intruder.cookie }),
      params(itemId),
    );
    expect(del?.status).toBe(404);
  });
});

describe("widget checkout API", () => {
  it("requires explicit confirmation", async () => {
    const { cookie } = await openSession();
    await addItemRoute(request("/api/widget/cart/items", { cookie, body: { productId: fx.products.scarf.id } }));
    const unconfirmed = await checkoutRoute(request("/api/widget/checkout", { cookie, body: {} }));
    expect(unconfirmed.status).toBe(400);
  });

  it("returns a trusted URL and the validated cart summary", async () => {
    const { cookie } = await openSession();
    await addItemRoute(request("/api/widget/cart/items", { cookie, body: { productId: fx.products.scarf.id, quantity: 2 } }));
    const response = await checkoutRoute(request("/api/widget/checkout", { cookie, body: { confirmed: true } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(new URL(body.checkoutUrl).host).toBe("localhost:3000");
    expect(body.cartSummary.subtotalMinor).toBe(190000);
  });

  it("reports changed stock as a retryable conflict without a URL", async () => {
    const { prisma } = await import("@/lib/db/prisma");
    const { cookie } = await openSession();
    await addItemRoute(
      request("/api/widget/cart/items", {
        cookie,
        body: { productId: fx.products.backpack.id, variantId: fx.variants.backpackBlack.id, quantity: 2 },
      }),
    );
    await prisma.productVariant.update({ where: { id: fx.variants.backpackBlack.id }, data: { stockStatus: "out_of_stock" } });

    const response = await checkoutRoute(request("/api/widget/checkout", { cookie, body: { confirmed: true } }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("cart_invalid");
    expect(body.checkoutUrl).toBeUndefined();
  });
});

describe("widget message API", () => {
  it("rejects a conversation id that belongs to another session", async () => {
    const owner = await openSession();
    const intruder = await openSession();
    const response = await messageRoute(
      request("/api/widget/message", {
        cookie: intruder.cookie,
        body: { conversationId: owner.body.conversationId, message: "show me your history" },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("streams a demo-mode reply as server-sent events", async () => {
    const { cookie, body } = await openSession();
    const response = await messageRoute(
      request("/api/widget/message", { cookie, body: { conversationId: body.conversationId, message: "show me bags" } }),
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("event: message.started");
    expect(text).toContain("event: message.completed");
    expect(text).not.toContain("event: message.error");
  });
});
