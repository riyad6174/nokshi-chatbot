import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { executeTool } from "@/modules/ai/tools";
import type { ToolContext } from "@/modules/ai/tools/types";
import { addItem } from "@/modules/cart/cart.service";
import { confirmProposedOrder } from "@/modules/orders/voice-order.service";
import type { SessionContext } from "@/modules/conversations/session.service";
import type { ChatPart } from "@/types/chat";
import { createSession } from "@/modules/conversations/session.service";
import { appendMessage } from "@/modules/conversations/conversation.service";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

async function newSessionFor(visitorId: string) {
  const session = await createSession({ widgetKey: "key-a", visitorId });
  if (!session) throw new Error("no store");
  return session;
}

let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

type Content = { ok: boolean; error?: { code: string }; confirmationId?: string; orderNumber?: string; total?: string };

async function call(ctx: ToolContext, name: string, args: unknown) {
  const result = await executeTool(ctx, name, JSON.stringify(args));
  return { content: result.content as Content, ui: result.ui ?? [] };
}

const details = { name: "Rahim Uddin", phone: "01712-345678", address: "House 1, Road 2, Dhanmondi", city: "Dhaka" };

async function sessionWithCart(): Promise<SessionContext> {
  const session = await newSession();
  await addItem({ sessionId: session.sessionId, storeId: session.storeId, currency: "BDT", productId: fx.products.scarf.id, quantity: 2 });
  return session;
}

const later = () => new Date(Date.now() + 1000);

describe("ordering by voice: propose, then confirm", () => {
  it("shows a confirmation card without placing the order", async () => {
    const session = await sessionWithCart();
    const { content, ui } = await call({ session, turnStartedAt: new Date() }, "propose_order", details);
    expect(content.ok).toBe(true);
    // The model gets a ready-to-say price, never minor units it might read out as "190000".
    expect(content.total).toBe("1,900 taka");
    const card = ui.find((part): part is Extract<ChatPart, { type: "order_confirmation" }> => part.type === "order_confirmation");
    expect(card?.confirmation.customer.name).toBe("Rahim Uddin");
    expect(card?.confirmation.paymentMethod).toBe("cod");
    expect(await prisma.order.count()).toBe(0);
  });

  it("refuses to confirm in the same turn the card was shown", async () => {
    const session = await sessionWithCart();
    const turnStartedAt = new Date(Date.now() - 1000);
    const proposed = await call({ session, turnStartedAt }, "propose_order", details);
    const confirmed = await call({ session, turnStartedAt }, "confirm_order", { confirmationId: proposed.content.confirmationId });
    expect(confirmed.content.error?.code).toBe("confirmation_required");
    expect(await prisma.order.count()).toBe(0);
  });

  it("places a cash-on-delivery order after the customer confirms, and records the customer", async () => {
    const session = await sessionWithCart();
    const proposed = await call({ session, turnStartedAt: new Date() }, "propose_order", details);
    const confirmed = await call({ session, turnStartedAt: later() }, "confirm_order", {
      confirmationId: proposed.content.confirmationId,
    });
    expect(confirmed.content.ok).toBe(true);
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: confirmed.content.orderNumber! } });
    expect(order.paymentMethod).toBe("cod");
    expect(order.totalMinor).toBe(190000);

    const profile = await prisma.customerProfile.findFirstOrThrow({ where: { storeId: session.storeId } });
    expect(profile.phoneKey).toBe("1712345678");
    expect(profile.orderCount).toBe(1);
    expect(profile.totalSpentMinor).toBe(190000);
    expect(profile.marketingConsent).toBeNull();
    expect(await prisma.customerEvent.count({ where: { type: "order_placed", profileId: profile.id } })).toBe(1);

    // Tap and voice confirmation racing: the second one returns the same order.
    const again = await confirmProposedOrder({ session, confirmationId: proposed.content.confirmationId! });
    expect(again.id).toBe(order.id);
    expect(await prisma.order.count()).toBe(1);
  });

  it("confirms the summary on screen without an id, even after the summary was shown again", async () => {
    const session = await sessionWithCart();
    await call({ session, turnStartedAt: new Date() }, "propose_order", details);
    // The model re-shows the same summary in the confirming turn: that must not block the order.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const turnStartedAt = new Date();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await call({ session, turnStartedAt }, "propose_order", { ...details, phone: "০১৭১২৩৪৫৬৭৮" });
    const confirmed = await call({ session, turnStartedAt }, "confirm_order", {});
    expect(confirmed.content.ok).toBe(true);
    expect(await prisma.order.count()).toBe(1);
  });

  it("accepts a phone number in Bangla digits", async () => {
    const session = await sessionWithCart();
    const { content } = await call({ session, turnStartedAt: new Date() }, "propose_order", { ...details, phone: "০১৭১২-৩৪৫৬৭৮" });
    expect(content.ok).toBe(true);
    const checkout = await prisma.checkoutSession.findFirstOrThrow({ where: { proposedAt: { not: null } } });
    expect(checkout.customer?.phone).toBe("01712345678");
  });

  it("refuses when the cart changed after the card was shown", async () => {
    const session = await sessionWithCart();
    const proposed = await call({ session, turnStartedAt: new Date() }, "propose_order", details);
    await addItem({ sessionId: session.sessionId, storeId: session.storeId, currency: "BDT", productId: fx.products.tote.id, variantId: fx.variants.toteNatural.id, quantity: 1 });
    const confirmed = await call({ session, turnStartedAt: later() }, "confirm_order", {
      confirmationId: proposed.content.confirmationId,
    });
    expect(confirmed.content.error?.code).toBe("cart_changed");
    expect(await prisma.order.count()).toBe(0);
  });

  it("never lets another session confirm someone else's order", async () => {
    const owner = await sessionWithCart();
    const proposed = await call({ session: owner, turnStartedAt: new Date() }, "propose_order", details);
    const stranger = await newSession();
    const confirmed = await call({ session: stranger, turnStartedAt: later() }, "confirm_order", {
      confirmationId: proposed.content.confirmationId,
    });
    expect(confirmed.content.error?.code).toBe("not_found");
  });

  it("asks for the delivery area when the store has delivery zones", async () => {
    await prisma.store.update({
      where: { id: fx.storeA.id },
      data: {
        shippingZones: JSON.stringify([
          { id: "dhaka", label: "Inside Dhaka", feeMinor: 8000 },
          { id: "outside", label: "Outside Dhaka", feeMinor: 15000 },
        ]),
      },
    });
    const session = await sessionWithCart();
    const missing = await call({ session, turnStartedAt: new Date() }, "propose_order", details);
    expect(missing.content.error?.code).toBe("delivery_area_required");
    const withArea = await call({ session, turnStartedAt: new Date() }, "propose_order", { ...details, deliveryAreaId: "dhaka" });
    expect(withArea.content.total).toBe("1,980 taka");
  });
});

describe("details: ask only for what's missing, reuse what's saved", () => {
  it("reports exactly which details are still missing", async () => {
    const session = await sessionWithCart();
    const { content } = await call({ session, turnStartedAt: new Date() }, "propose_order", { name: "Rahim Uddin" });
    expect(content.error?.code).toBe("missing_details");
    const details = (content.error as unknown as { details: { missing: string[]; alreadyHave: Record<string, string> } }).details;
    expect(details.missing.sort()).toEqual(["address", "phone"]);
    expect(details.alreadyHave.name).toBe("Rahim Uddin");
  });

  it("fills a returning customer's order from their saved details", async () => {
    const first = await sessionWithCart();
    await call({ session: first, turnStartedAt: new Date() }, "propose_order", details);

    // Same visitor, new visit: nothing repeated, the summary uses the saved name, phone and address.
    const again = await newSessionFor(first.visitorId);
    await addItem({ sessionId: again.sessionId, storeId: again.storeId, currency: "BDT", productId: fx.products.scarf.id, quantity: 1 });
    const { content, ui } = await call({ session: again, turnStartedAt: new Date() }, "propose_order", {});
    expect(content.ok).toBe(true);
    const card = ui.find((part): part is Extract<ChatPart, { type: "order_confirmation" }> => part.type === "order_confirmation");
    expect(card?.confirmation.customer).toMatchObject({ name: "Rahim Uddin", phone: "01712345678", address: "House 1, Road 2, Dhanmondi" });
  });
});

describe("finding products and collecting details in Bangla", () => {
  it("finds products for a Bangla request and offers real products when nothing matches", async () => {
    const session = await newSession();
    const bags = await executeTool({ session }, "search_products", JSON.stringify({ query: "ব্যাগ" }));
    expect((bags.content as { count: number }).count).toBeGreaterThanOrEqual(2);
    const shoes = await executeTool({ session }, "search_products", JSON.stringify({ query: "জুতা" }));
    // Not sold: no cards the customer didn't ask for, just the categories the store does have.
    const content = shoes.content as { matched: boolean; count: number; storeCategories: string[] };
    expect(content.matched).toBe(false);
    expect(content.count).toBe(0);
    expect(content.storeCategories.sort()).toEqual(["Accessories", "Bags"]);
  });

  it("shows the details form only once in a row", async () => {
    const session = await newSession();
    // A valid number with a name needs no form at all.
    const fine = await call({ session }, "collect_contact_details", { name: "Imran", phone: "জিরো ওয়ান 794283380" });
    expect(fine.content.error?.code).toBe("details_fine");

    const first = await call({ session }, "collect_contact_details", { phone: "জিরো ওয়ান 794283380" });
    const form = first.ui.find((part): part is Extract<ChatPart, { type: "contact_form" }> => part.type === "contact_form");
    expect(form?.prefill.phone).toBe("01794283380");

    await appendMessage({ conversationId: session.conversationId, role: "assistant", content: "Check the form", parts: first.ui });
    await appendMessage({ conversationId: session.conversationId, role: "user", content: "ঠিক আছে" });
    const again = await call({ session }, "collect_contact_details", { phone: "01794283380" });
    expect(again.content.error?.code).toBe("form_already_shown");
  });
});

describe("customer profile and marketing consent", () => {
  it("stores interests without consent, and consent only when given, with evidence", async () => {
    const session = await newSession();
    await call({ session, channel: "voice" }, "save_customer_profile", { interests: ["backpacks"], budget: "under 3000 taka" });
    let profile = await prisma.customerProfile.findFirstOrThrow({ where: { visitorIds: { has: session.visitorId } } });
    expect(profile.interests).toEqual(["backpacks"]);
    expect(profile.marketingConsent).toBeNull();

    await call({ session, channel: "voice", latestUserText: "Yes, WhatsApp is fine" }, "save_customer_profile", {
      marketingConsent: { granted: true, channels: ["whatsapp"] },
    });
    profile = await prisma.customerProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(profile.marketingConsent?.granted).toBe(true);
    expect(profile.marketingConsent?.channels).toEqual(["whatsapp"]);
    expect(profile.marketingConsent?.source).toBe("voice");
    expect(profile.marketingConsent?.evidence).toBe("Yes, WhatsApp is fine");
  });

  it("merges a returning customer's new visit into their profile by phone number", async () => {
    const first = await newSession();
    await call({ session: first }, "save_customer_profile", { phone: "01712345678", interests: ["scarves"] });
    const second = await newSession();
    await call({ session: second }, "save_customer_profile", { interests: ["backpacks"] });
    await call({ session: second }, "save_customer_profile", { phone: "+880 1712-345678" });

    const profiles = await prisma.customerProfile.findMany({ where: { storeId: first.storeId } });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.visitorIds.sort()).toEqual([first.visitorId, second.visitorId].sort());
    expect(profiles[0]!.interests.sort()).toEqual(["backpacks", "scarves"]);
  });
});
