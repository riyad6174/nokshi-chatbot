import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { addItem } from "@/modules/cart/cart.service";
import { getProviderHistory } from "@/modules/conversations/conversation.service";
import { getSessionContext } from "@/modules/conversations/session.service";
import { handleEngagementEvent, type EngagementEvent } from "@/modules/sales/engagement.service";
import { getEngagementState } from "@/modules/sales/state";
import { FASHION_PRODUCTS, GROCERY_PRODUCTS, ELECTRONICS_PRODUCTS, newSession, resetDb, seedIndustryStore } from "../helpers/fixtures";

beforeEach(async () => {
  await resetDb();
});

async function fire(session: Awaited<ReturnType<typeof newSession>>, event: EngagementEvent, now?: Date) {
  // Fresh context each time, as each HTTP request gets.
  const context = (await getSessionContext(session.sessionId))!;
  return handleEngagementEvent(context, event, now);
}

const fashion = (salesConfig?: Record<string, unknown>) =>
  seedIndustryStore({ widgetKey: "fashion", industry: "fashion", products: FASHION_PRODUCTS, salesConfig });

describe("proactive suggestions", () => {
  it("suggests matching pants when a shirt is added to the cart", async () => {
    const { ids } = await fashion();
    const session = await newSession("fashion");
    const decision = await fire(session, { type: "add_to_cart", productId: ids["Oxford Shirt"]! });
    expect(decision.show).toBe(true);
    const text = decision.message!.parts.find((part) => part.type === "text");
    expect(text?.type === "text" && text.text).toMatch(/^That Oxford Shirt would look great with Beige Chinos/);
    const list = decision.message!.parts.find((part) => part.type === "product_list");
    expect(list?.type === "product_list" && list.products[0]?.name).toBe("Beige Chinos");
    expect(decision.message!.parts.some((part) => part.type === "suggestion_actions")).toBe(true);
    // Saved in the conversation, and the AI knows it was a proactive suggestion.
    const history = await getProviderHistory(session.conversationId);
    expect(history.at(-1)?.content).toContain("proactive suggestion");
    expect(await prisma.customerEvent.count({ where: { sessionId: session.sessionId, type: "proactive_shown" } })).toBe(1);
  });

  it("suggests recipe ingredients after a grocery search", async () => {
    await seedIndustryStore({ widgetKey: "grocery", industry: "grocery", products: GROCERY_PRODUCTS });
    const session = await newSession("grocery");
    const decision = await fire(session, { type: "search", query: "potatoes" });
    expect(decision.show).toBe(true);
    const text = decision.message!.parts.find((part) => part.type === "text");
    expect(text?.type === "text" && text.text).toContain("Planning potato curry?");
    const list = decision.message!.parts.find((part) => part.type === "product_list");
    const names = list?.type === "product_list" ? list.products.map((product) => product.name) : [];
    expect(names).toEqual(expect.arrayContaining(["Red Onions 1kg"]));
    expect(names).not.toContain("Garlic 250g");
  });

  it("suggests only compatible accessories for a phone page after the dwell time", async () => {
    const { ids } = await seedIndustryStore({ widgetKey: "tech", industry: "electronics", products: ELECTRONICS_PRODUCTS });
    const session = await newSession("tech");
    const early = await fire(session, { type: "product_view", productId: ids["Phone X"]!, dwellSeconds: 5 });
    expect(early).toMatchObject({ show: false, reason: "wait" });
    expect(early.retryAfterSeconds).toBeGreaterThan(0);
    const later = await fire(session, { type: "product_view", productId: ids["Phone X"]!, dwellSeconds: 40 });
    expect(later.show).toBe(true);
    const list = later.message!.parts.find((part) => part.type === "product_list");
    const names = list?.type === "product_list" ? list.products.map((product) => product.name) : [];
    expect(names.length).toBeGreaterThan(0);
    expect(names).not.toContain("Phone Y Leather Case");
    expect(names).not.toContain("Lightning Cable");
  });

  it("stays silent when nothing relevant is configured (no filler suggestions)", async () => {
    const { ids } = await fashion({ relationships: [] });
    const session = await newSession("fashion");
    expect(await fire(session, { type: "add_to_cart", productId: ids["Leather Belt"]! })).toMatchObject({ show: false, reason: "not_relevant" });
  });

  it("is off for stores that haven't enabled it", async () => {
    const { ids } = await seedIndustryStore({ widgetKey: "plain", industry: "general", products: FASHION_PRODUCTS });
    const session = await newSession("plain");
    expect(await fire(session, { type: "add_to_cart", productId: ids["Oxford Shirt"]! })).toMatchObject({ show: false, reason: "disabled" });
  });
});

describe("respecting the customer", () => {
  it("never repeats a suggestion and keeps to the per-visit limit and spacing", async () => {
    const { ids } = await fashion({ engagement: { maxPerSession: 2, minSecondsBetween: 60 } });
    const session = await newSession("fashion");
    const t0 = new Date();
    expect((await fire(session, { type: "add_to_cart", productId: ids["Oxford Shirt"]! }, t0)).show).toBe(true);
    // Too soon after the first one.
    const soon = await fire(session, { type: "product_view", productId: ids["Beige Chinos"]!, dwellSeconds: 60 }, new Date(t0.getTime() + 10_000));
    expect(soon.reason).toBe("too_soon");
    // Same trigger and product again: already shown.
    const again = await fire(session, { type: "add_to_cart", productId: ids["Oxford Shirt"]! }, new Date(t0.getTime() + 120_000));
    expect(again.reason).toBe("already_shown");
    const second = await fire(session, { type: "product_view", productId: ids["Beige Chinos"]!, dwellSeconds: 60 }, new Date(t0.getTime() + 200_000));
    expect(second.show).toBe(true);
    // The pants suggested before aren't suggested again.
    const list = second.message!.parts.find((part) => part.type === "product_list");
    expect(list?.type === "product_list" && list.products.map((product) => product.id)).not.toContain(ids["Beige Chinos"]);
    const third = await fire(session, { type: "product_view", productId: ids["Red Joggers"]!, dwellSeconds: 60 }, new Date(t0.getTime() + 400_000));
    expect(third.reason).toBe("limit_reached");
  });

  it("stops after 'Stop suggestions', remembers it for the visitor, and resumes on opt-in", async () => {
    const { ids } = await fashion({ engagement: { minSecondsBetween: 0 } });
    const session = await newSession("fashion");
    const optOut = await fire(session, { type: "opt_out" });
    expect(optOut.message?.parts[0]).toMatchObject({ type: "text", text: expect.stringContaining("no more suggestions") });
    expect(await fire(session, { type: "add_to_cart", productId: ids["Oxford Shirt"]! })).toMatchObject({ show: false, reason: "opted_out" });

    // Remembered on the profile for the next visit by the same visitor.
    await prisma.customerProfile.create({ data: { storeId: session.storeId, visitorIds: [session.visitorId], interests: [] } });
    await fire(session, { type: "opt_out" });
    const nextVisit = await (await import("@/modules/conversations/session.service")).createSession({ widgetKey: "fashion", visitorId: session.visitorId });
    const nextContext = (await getSessionContext(nextVisit!.sessionId))!;
    expect(await handleEngagementEvent(nextContext, { type: "add_to_cart", productId: ids["Oxford Shirt"]! })).toMatchObject({ reason: "opted_out" });

    await handleEngagementEvent(nextContext, { type: "opt_in" });
    expect((await handleEngagementEvent(nextContext, { type: "add_to_cart", productId: ids["Oxford Shirt"]! })).show).toBe(true);
  });

  it("'No thanks' hides those products from later suggestions", async () => {
    const { ids } = await fashion({ engagement: { minSecondsBetween: 0 } });
    const session = await newSession("fashion");
    const first = await fire(session, { type: "add_to_cart", productId: ids["Oxford Shirt"]! });
    await fire(session, { type: "dismiss", suggestionId: first.suggestionId! });
    const state = await getEngagementState(session.sessionId);
    expect(state.dismissedProductIds).toContain(ids["Beige Chinos"]);
    expect(await prisma.customerEvent.count({ where: { sessionId: session.sessionId, type: "proactive_dismissed" } })).toBe(1);
  });

  it("doesn't interrupt checkout or a human agent", async () => {
    const { ids } = await fashion({ engagement: { minSecondsBetween: 0 } });
    const session = await newSession("fashion");
    await fire(session, { type: "checkout_start" });
    expect(await fire(session, { type: "add_to_cart", productId: ids["Oxford Shirt"]! })).toMatchObject({ reason: "checking_out" });

    const other = await newSession("fashion");
    await prisma.conversation.update({ where: { id: other.conversationId }, data: { status: "human" } });
    expect(await fire(other, { type: "add_to_cart", productId: ids["Oxford Shirt"]! })).toMatchObject({ reason: "human_or_closed" });
  });

  it("checks real cart idle time on the server", async () => {
    const { ids, store } = await fashion({ engagement: { minSecondsBetween: 0, triggers: { cart_idle: { enabled: true, delaySeconds: 300 } } } });
    const session = await newSession("fashion");
    await addItem({ sessionId: session.sessionId, storeId: store.id, currency: "BDT", productId: ids["Leather Belt"]!, variantId: null, quantity: 1 });
    const now = await fire(session, { type: "cart_idle" });
    expect(now.reason).toBe("wait");
    const later = await fire(session, { type: "cart_idle" }, new Date(Date.now() + 301_000));
    expect(later.show).toBe(true);
    expect(later.message!.parts[0]).toMatchObject({ type: "text", text: expect.stringContaining("Leather Belt") });
  });
});

describe("store isolation", () => {
  it("can't anchor on another store's product", async () => {
    await fashion();
    const other = await seedIndustryStore({ widgetKey: "other", industry: "fashion", products: FASHION_PRODUCTS });
    const session = await newSession("fashion");
    expect(await fire(session, { type: "add_to_cart", productId: other.ids["Oxford Shirt"]! })).toMatchObject({ show: false, reason: "unknown_product" });
  });
});
