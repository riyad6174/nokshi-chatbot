import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { rateLimitMongoForTest } from "@/lib/rate-limit";
import { addItem } from "@/modules/cart/cart.service";
import { prepareCheckoutForSession } from "@/modules/commerce/checkout.service";
import { placeOrderFromCheckout } from "@/modules/orders/order.service";
import { claimNextJob, enqueueJob, PermanentJobError, registerJobHandler, runDueJobs, runJob } from "@/modules/jobs/job.service";
import { recordAiTurn, recentAiErrorRate } from "@/modules/analytics/turn-log.service";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

const customer = { name: "Rahim Uddin", phone: "+880 1712-345678", email: "", address: "House 4, Road 2, Dhanmondi", city: "Dhaka", notes: "" };

describe("checkout idempotency and inventory concurrency", () => {
  it("places exactly one order when the same checkout is submitted twice at once", async () => {
    const session = await newSession();
    await addItem({ sessionId: session.sessionId, storeId: session.storeId, currency: "BDT", productId: fx.products.backpack.id, variantId: fx.variants.backpackBlack.id, quantity: 2 });
    const store = await prisma.store.findUniqueOrThrow({ where: { id: session.storeId } });
    const prepared = await prepareCheckoutForSession({ sessionId: session.sessionId, store });
    const token = prepared.checkoutUrl.split("/checkout/")[1]!;

    const results = await Promise.allSettled([
      placeOrderFromCheckout({ token, customer, shippingZoneId: "", paymentMethod: "cod" }),
      placeOrderFromCheckout({ token, customer, shippingZoneId: "", paymentMethod: "cod" }),
      placeOrderFromCheckout({ token, customer, shippingZoneId: "", paymentMethod: "cod" }),
    ]);
    const placed = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof placeOrderFromCheckout>>> => result.status === "fulfilled");
    expect(placed.length).toBeGreaterThanOrEqual(1);
    // Every successful submit returns the same order.
    expect(new Set(placed.map((result) => result.value.id)).size).toBe(1);
    expect(await prisma.order.count({ where: { storeId: session.storeId } })).toBe(1);
    // Stock reserved once: 5 - 2.
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: fx.variants.backpackBlack.id } })).stockQuantity).toBe(3);
  });

  it("never oversells the last units across two carts", async () => {
    const tokens: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const session = await newSession();
      await addItem({ sessionId: session.sessionId, storeId: session.storeId, currency: "BDT", productId: fx.products.backpack.id, variantId: fx.variants.backpackOlive.id, quantity: 2 });
      const store = await prisma.store.findUniqueOrThrow({ where: { id: session.storeId } });
      tokens.push((await prepareCheckoutForSession({ sessionId: session.sessionId, store })).checkoutUrl.split("/checkout/")[1]!);
    }
    const results = await Promise.allSettled(tokens.map((token) => placeOrderFromCheckout({ token, customer, shippingZoneId: "", paymentMethod: "cod" })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const stock = (await prisma.productVariant.findUniqueOrThrow({ where: { id: fx.variants.backpackOlive.id } })).stockQuantity;
    expect(stock).toBe(1); // 3 - 2, never negative
  });
});

describe("durable job queue", () => {
  it("enqueues once per dedupe key", async () => {
    const first = await enqueueJob({ type: "test.noop", dedupeKey: "cart-1" });
    const again = await enqueueJob({ type: "test.noop", dedupeKey: "cart-1" });
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });
    expect(await prisma.job.count({ where: { type: "test.noop" } })).toBe(1);
  });

  it("lets only one worker claim a job", async () => {
    await enqueueJob({ type: "test.claim", dedupeKey: "only" });
    const claims = await Promise.all([claimNextJob(new Date(), ["test.claim"]), claimNextJob(new Date(), ["test.claim"]), claimNextJob(new Date(), ["test.claim"])]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("retries failures with backoff and stops on permanent errors", async () => {
    let calls = 0;
    registerJobHandler("test.flaky", async () => {
      calls += 1;
      throw new Error("temporary outage");
    });
    registerJobHandler("test.permanent", async () => {
      throw new PermanentJobError("bad payload");
    });
    registerJobHandler("test.ok", async () => undefined);

    await enqueueJob({ type: "test.flaky", dedupeKey: "f", maxAttempts: 2 });
    await enqueueJob({ type: "test.permanent", dedupeKey: "p" });
    await enqueueJob({ type: "test.ok", dedupeKey: "o" });
    const counts = await runDueJobs({ types: ["test.flaky", "test.permanent", "test.ok"] });
    expect(counts).toEqual({ done: 1, retry: 1, failed: 1 });

    const flaky = await prisma.job.findFirstOrThrow({ where: { type: "test.flaky" } });
    expect(flaky.status).toBe("queued");
    expect(flaky.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(flaky.lastError).toBe("temporary outage");

    // Second (last) attempt fails for good.
    await prisma.job.update({ where: { id: flaky.id }, data: { runAt: new Date(Date.now() - 1000) } });
    const job = await claimNextJob(new Date(), ["test.flaky"]);
    expect(await runJob(job!)).toBe("failed");
    expect(calls).toBe(2);
  });

  it("picks up a job whose worker died once its lock expires", async () => {
    const { id } = await enqueueJob({ type: "test.stale", dedupeKey: "s" });
    await prisma.job.update({ where: { id }, data: { status: "running", lockedUntil: new Date(Date.now() - 1000), attempts: 1 } });
    const claimed = await claimNextJob(new Date(), ["test.stale"]);
    expect(claimed?.id).toBe(id);
    expect(claimed?.attempts).toBe(2);
  });
});

describe("distributed rate limiting", () => {
  it("counts across callers in MongoDB and blocks over the limit", async () => {
    const key = `test:${Date.now()}`;
    const results = await Promise.all(Array.from({ length: 5 }, () => rateLimitMongoForTest(key, 3, 60_000)));
    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    const blocked = results.find((result) => !result.allowed)!;
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("AI turn telemetry", () => {
  it("records turns and reports the error rate per store", async () => {
    const session = await newSession();
    const base = { storeId: session.storeId, conversationId: session.conversationId, sessionId: session.sessionId, channel: "text" as const, mode: "live" as const };
    await recordAiTurn({ ...base, outcome: "answered", latencyMs: 900, toolLog: [{ name: "search_products", ok: true, code: "", ms: 30 }] });
    await recordAiTurn({ ...base, outcome: "error", latencyMs: 45_000 });
    await recordAiTurn({ ...base, outcome: "answered", latencyMs: 700, toolLog: [{ name: "add_to_cart", ok: false, code: "out_of_stock", ms: 12 }] });
    const rate = await recentAiErrorRate(session.storeId);
    expect(rate).toMatchObject({ total: 3, errors: 1 });
    const withToolError = await prisma.aiTurnLog.findFirst({ where: { toolErrorCount: 1 } });
    expect(withToolError?.toolCalls[0]).toMatchObject({ name: "add_to_cart", code: "out_of_stock" });
    expect(await recentAiErrorRate(fx.storeB.id)).toMatchObject({ total: 0 });
  });
});
