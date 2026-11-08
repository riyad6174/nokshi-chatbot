import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { addItem } from "@/modules/cart/cart.service";
import { flagAbandonedCarts } from "@/modules/customers/events.service";
import { runDueJobs } from "@/modules/jobs/job.service";
import { createCampaign, launchCampaign, scheduleAbandonedCartReminders } from "@/modules/marketing/campaign.service";
import { applyUnsubscribe, canMarket, unsubscribeToken } from "@/modules/marketing/consent";
import { previewSegment } from "@/modules/marketing/segments";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

const consent = (channels: string[]) => ({ granted: true, channels, at: new Date(), source: "chat", wording: "q", evidence: "yes" });

async function profileFor(session: Awaited<ReturnType<typeof newSession>>, extra: Record<string, unknown> = {}) {
  return prisma.customerProfile.create({
    data: { storeId: session.storeId, visitorIds: [session.visitorId], interests: [], name: "Rahim", phone: "01712345678", phoneKey: "1712345678", ...extra },
  });
}

/** Moves time forward for jobs that are scheduled later. */
async function makeJobsDue() {
  await prisma.job.updateMany({ where: { status: "queued" }, data: { runAt: new Date(Date.now() - 1000) } });
}

describe("consent rules", () => {
  it("needs explicit consent for the channel and a contact, and respects unsubscribes", () => {
    const base = { email: "", phone: "01712345678", unsubscribedAt: null };
    expect(canMarket({ ...base, marketingConsent: null }, "sms")).toEqual({ ok: false, reason: "no_consent" });
    expect(canMarket({ ...base, marketingConsent: consent(["whatsapp"]) }, "sms")).toEqual({ ok: false, reason: "channel_not_consented" });
    expect(canMarket({ ...base, marketingConsent: consent(["email"]) }, "email")).toEqual({ ok: false, reason: "no_email" });
    expect(canMarket({ ...base, marketingConsent: consent(["sms"]) }, "sms")).toEqual({ ok: true, recipient: "01712345678" });
    expect(canMarket({ ...base, unsubscribedAt: new Date(), marketingConsent: consent(["sms"]) }, "sms").ok).toBe(false);
  });
});

describe("abandoned-cart recovery", () => {
  it("reminds a consenting customer once, with their cart and real suggestions, and never without consent", async () => {
    const consenting = await newSession();
    const silent = await newSession();
    await profileFor(consenting, { marketingConsent: consent(["sms"]) });
    await profileFor(silent, { phone: "01811111111", phoneKey: "1811111111" });
    for (const session of [consenting, silent]) {
      await addItem({ sessionId: session.sessionId, storeId: session.storeId, currency: "BDT", productId: fx.products.scarf.id, variantId: null, quantity: 1 });
      await prisma.cart.updateMany({ where: { sessionId: session.sessionId }, data: { updatedAt: new Date(Date.now() - 3 * 3600_000) } });
    }
    const campaign = await createCampaign(fx.storeA.id, { name: "Cart", kind: "abandoned_cart", channel: "sms", body: "Hi {name}, your {cart} is waiting at {store}: {link}", delayMinutes: 30 });
    await launchCampaign(fx.storeA.id, campaign.id);

    expect(await flagAbandonedCarts()).toBe(2);
    expect(await scheduleAbandonedCartReminders()).toBe(1);
    expect(await scheduleAbandonedCartReminders()).toBe(0); // idempotent
    await makeJobsDue();
    await runDueJobs();
    await makeJobsDue();
    await runDueJobs();

    const messages = await prisma.marketingMessage.findMany({ where: { campaignId: campaign.id } });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ status: "sent", recipient: "01712345678" });
    expect(messages[0]!.body).toContain("1x Handloom Scarf");
    expect(messages[0]!.body).toContain("/api/marketing/unsubscribe?token=");
    expect(messages[0]!.body).toContain("/api/marketing/click?t=");
  });

  it("skips the reminder if the customer ordered or unsubscribed in the meantime", async () => {
    const session = await newSession();
    const profile = await profileFor(session, { marketingConsent: consent(["sms"]) });
    await addItem({ sessionId: session.sessionId, storeId: session.storeId, currency: "BDT", productId: fx.products.scarf.id, variantId: null, quantity: 1 });
    await prisma.cart.updateMany({ where: { sessionId: session.sessionId }, data: { updatedAt: new Date(Date.now() - 3 * 3600_000) } });
    const campaign = await createCampaign(fx.storeA.id, { name: "Cart", kind: "abandoned_cart", channel: "sms", body: "Your {cart} is waiting: {link}" });
    await launchCampaign(fx.storeA.id, campaign.id);
    await flagAbandonedCarts();
    await scheduleAbandonedCartReminders();
    await makeJobsDue();
    await runDueJobs({ types: ["marketing.abandoned_cart"] }); // queues the send job
    expect(await prisma.marketingMessage.count({ where: { campaignId: campaign.id, status: "queued" } })).toBe(1);
    expect(await applyUnsubscribe(unsubscribeToken(profile.id, fx.storeA.id))).toMatchObject({ ok: true });
    await makeJobsDue();
    await runDueJobs();
    const message = await prisma.marketingMessage.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(message.status).toBe("skipped");
    expect(message.reason).toBe("unsubscribed");
    const updated = await prisma.customerProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(updated.marketingConsent?.granted).toBe(false);
    expect(updated.unsubscribedAt).not.toBeNull();
  });
});

describe("campaigns and segments", () => {
  it("sends a broadcast only to consenting customers in the segment", async () => {
    const a = await newSession();
    const b = await newSession();
    const c = await newSession();
    await profileFor(a, { marketingConsent: consent(["email"]), email: "a@example.com", orderCount: 3 });
    await profileFor(b, { marketingConsent: consent(["email"]), email: "b@example.com", orderCount: 0, phone: "01822222222", phoneKey: "1822222222" });
    await profileFor(c, { email: "c@example.com", orderCount: 5, phone: "01833333333", phoneKey: "1833333333" });
    expect(await previewSegment(fx.storeA.id, { minOrders: 1 }, "email")).toEqual({ matched: 2, reachable: 1 });

    const campaign = await createCampaign(fx.storeA.id, { name: "VIP", kind: "broadcast", channel: "email", subject: "For you, {name}", body: "New picks for you: {products}", segment: { minOrders: 1 } });
    expect(await launchCampaign(fx.storeA.id, campaign.id)).toEqual({ queued: 1, skipped: 1 });
    await runDueJobs();
    const sent = await prisma.marketingMessage.findMany({ where: { campaignId: campaign.id, status: "sent" } });
    expect(sent.map((message) => message.recipient)).toEqual(["a@example.com"]);
    expect(sent[0]!.subject).toBe("For you, Rahim");
    // Launching again sends nothing new.
    await launchCampaign(fx.storeA.id, campaign.id);
    expect(await prisma.marketingMessage.count({ where: { campaignId: campaign.id } })).toBe(1);
  });

  it("rejects forged or wrong-kind unsubscribe tokens", async () => {
    expect(await applyUnsubscribe("garbage.token")).toEqual({ ok: false });
    const { seal } = await import("@/lib/auth/tokens");
    expect(await applyUnsubscribe(seal({ sid: "x", exp: Date.now() + 1000 }))).toEqual({ ok: false });
  });

  it("delivers through the signed webhook when configured", async () => {
    const session = await newSession();
    await profileFor(session, { marketingConsent: consent(["whatsapp"]) });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    process.env.MARKETING_PROVIDER = "webhook";
    process.env.MARKETING_WEBHOOK_URL = "http://hooks.test/send";
    process.env.MARKETING_WEBHOOK_SECRET = "hook-secret";
    try {
      const campaign = await createCampaign(fx.storeA.id, { name: "WA", kind: "broadcast", channel: "whatsapp", body: "Hello {name} from {store}" });
      await launchCampaign(fx.storeA.id, campaign.id);
      await runDueJobs();
      const call = fetchSpy.mock.calls.find(([url]) => String(url) === "http://hooks.test/send");
      expect(call).toBeDefined();
      const headers = call![1]!.headers as Record<string, string>;
      expect(headers["X-Nokshi-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(JSON.parse(String(call![1]!.body))).toMatchObject({ channel: "whatsapp", to: "01712345678" });
    } finally {
      fetchSpy.mockRestore();
      delete process.env.MARKETING_PROVIDER;
      delete process.env.MARKETING_WEBHOOK_URL;
      delete process.env.MARKETING_WEBHOOK_SECRET;
    }
  });
});
