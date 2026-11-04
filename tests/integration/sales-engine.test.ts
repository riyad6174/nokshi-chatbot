import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { executeTool } from "@/modules/ai/tools";
import { buildSystemPromptParts } from "@/modules/ai/system-instructions";
import { addItem, getCartSummary } from "@/modules/cart/cart.service";
import { recommend } from "@/modules/catalog/recommendation.service";
import { presetConfig, resolveSalesConfig } from "@/modules/sales/config";
import { getEngagementState, setSuggestionOptOut } from "@/modules/sales/state";
import {
  ELECTRONICS_PRODUCTS,
  FASHION_PRODUCTS,
  GROCERY_PRODUCTS,
  newSession,
  resetDb,
  seedIndustryStore,
} from "../helpers/fixtures";

type Content = {
  ok: boolean;
  suppressed?: boolean;
  recipe?: string;
  otherRecipes?: string[];
  products: Array<{ id: string; name: string; reason: string; price: string; compatibilityVerified?: boolean }>;
  error?: { code: string };
};

async function tool(widgetKey: string, name: string, args: unknown, session?: Awaited<ReturnType<typeof newSession>>) {
  const ctx = session ?? (await newSession(widgetKey));
  const result = await executeTool({ session: ctx }, name, JSON.stringify(args));
  return { session: ctx, result, content: result.content as Content };
}

beforeEach(async () => {
  await resetDb();
});

describe("grocery: recipe-based recommendations", () => {
  it("finds potatoes, then suggests the other in-stock ingredients for a potato curry", async () => {
    const { ids } = await seedIndustryStore({ widgetKey: "grocery", industry: "grocery", products: GROCERY_PRODUCTS });

    const search = await tool("grocery", "search_products", { query: "potatoes" });
    expect(search.result.ok).toBe(true);
    expect(search.content.products.map((product) => product.name)).toContain("Fresh Potatoes 1kg");

    const { content, result } = await tool(
      "grocery",
      "get_recommendations",
      { kind: "recipe", productId: ids["Fresh Potatoes 1kg"], need: "curry", customerAsked: true },
      search.session,
    );
    expect(result.ok).toBe(true);
    expect(content.recipe).toBe("potato curry");
    const names = content.products.map((product) => product.name);
    expect(names).toEqual(expect.arrayContaining(["Red Onions 1kg", "Green Chilies 250g"]));
    expect(names).not.toContain("Garlic 250g"); // sold out
    expect(names).not.toContain("Fresh Potatoes 1kg"); // the anchor itself
    expect(content.products.find((product) => product.name === "Red Onions 1kg")?.reason).toBe("For potato curry: onion");
    // The assistant can ask "curry or something crispy?" from real recipe options.
    expect(content.otherRecipes).toEqual(expect.arrayContaining(["potato curry", "crispy potato fries"]));
    // Prices are labels from the catalog.
    expect(content.products.find((product) => product.name === "Red Onions 1kg")?.price).toBe("80 taka");
    expect(result.ui?.[0]).toMatchObject({ type: "product_list", label: "For your potato curry" });
  });

  it("gives the assistant the grocery persona and rules in the cached prompt", async () => {
    await seedIndustryStore({ widgetKey: "grocery", industry: "grocery", products: GROCERY_PRODUCTS });
    const session = await newSession("grocery");
    const cart = await getCartSummary(session.sessionId, session.storeId, "BDT");
    const { stable } = buildSystemPromptParts({ session, cart, configuredInstructions: "", enabledFeatures: "" });
    expect(stable).toContain("a friendly grocery shopping and cooking assistant");
    expect(stable).toContain("kind 'recipe'");
  });

  it("understands Banglish and Bangla grocery words in search", async () => {
    await seedIndustryStore({ widgetKey: "grocery", industry: "grocery", products: GROCERY_PRODUCTS });
    const banglish = await tool("grocery", "search_products", { query: "aloo" });
    expect(banglish.content.products.map((product) => product.name)).toContain("Fresh Potatoes 1kg");
    const bangla = await tool("grocery", "search_products", { query: "আলু" });
    expect(bangla.content.products.map((product) => product.name)).toContain("Fresh Potatoes 1kg");
  });
});

describe("fashion: complete the look", () => {
  it("suggests beige chinos for a white shirt, with a colour reason", async () => {
    const { ids } = await seedIndustryStore({ widgetKey: "fashion", industry: "fashion", products: FASHION_PRODUCTS });
    const { content } = await tool("fashion", "get_recommendations", {
      kind: "complete_the_look",
      productId: ids["Oxford Shirt"],
      customerAsked: true,
    });
    expect(content.products[0]?.name).toBe("Beige Chinos");
    expect(content.products[0]?.reason).toMatch(/Beige pairs well with white/i);
    const names = content.products.map((product) => product.name);
    expect(names).not.toContain("Retired Khaki Pants"); // inactive
    expect(names.indexOf("Red Joggers")).toBeGreaterThan(names.indexOf("Beige Chinos"));
  });

  it("respects the customer's budget", async () => {
    const { ids } = await seedIndustryStore({ widgetKey: "fashion", industry: "fashion", products: FASHION_PRODUCTS });
    const { content } = await tool("fashion", "get_recommendations", {
      kind: "complete_the_look",
      productId: ids["Oxford Shirt"],
      maxPriceMinor: 300000,
      customerAsked: true,
    });
    const names = content.products.map((product) => product.name);
    expect(names).not.toContain("Luxury Navy Trousers");
    expect(names).toContain("Beige Chinos");
  });
});

describe("electronics: compatible accessories", () => {
  it("returns only accessories that fit the phone", async () => {
    const { ids } = await seedIndustryStore({ widgetKey: "tech", industry: "electronics", products: ELECTRONICS_PRODUCTS });
    const { content } = await tool("tech", "get_recommendations", { kind: "compatible", productId: ids["Phone X"], customerAsked: true });
    const names = content.products.map((product) => product.name);
    expect(names).toEqual(expect.arrayContaining(["Phone X Silicone Case", "65W USB-C Charger"]));
    expect(names).not.toContain("Phone Y Leather Case");
    expect(names).not.toContain("Lightning Cable");
    expect(names).not.toContain("Phone X Glass Protector"); // out of stock (0 units)
    expect(content.products.every((product) => product.compatibilityVerified !== false)).toBe(true);
    expect(content.products.find((product) => product.name === "Phone X Silicone Case")?.reason).toContain("compatible_with: Phone X");
  });
});

describe("recommendation guarantees", () => {
  it("never returns another store's, inactive, sold-out or over-budget products", async () => {
    const fashion = await seedIndustryStore({ widgetKey: "fashion", industry: "fashion", products: FASHION_PRODUCTS });
    await seedIndustryStore({
      widgetKey: "other",
      industry: "fashion",
      products: [{ name: "Foreign Beige Chinos", category: "Pants", priceMinor: 1000, attributes: { color: "Beige" } }],
    });
    const result = await recommend({
      storeId: fashion.store.id,
      kind: "complete_the_look",
      anchorProductIds: [fashion.ids["Oxford Shirt"]!],
      config: resolveSalesConfig(fashion.store.settings),
      maxPriceMinor: 260000,
      limit: 6,
    });
    const names = result.recommendations.map((entry) => entry.product.name);
    expect(names).not.toContain("Foreign Beige Chinos");
    expect(names).not.toContain("Retired Khaki Pants");
    expect(names).not.toContain("Luxury Navy Trousers");
    for (const entry of result.recommendations) {
      expect(entry.product.available).toBe(true);
      expect(entry.product.priceMinor).toBeLessThanOrEqual(260000);
    }
  });

  it("ignores product ids from another store", async () => {
    await seedIndustryStore({ widgetKey: "fashion", industry: "fashion", products: FASHION_PRODUCTS });
    const other = await seedIndustryStore({ widgetKey: "other", industry: "fashion", products: FASHION_PRODUCTS });
    const { content } = await tool("fashion", "get_recommendations", {
      kind: "complete_the_look",
      productId: other.ids["Oxford Shirt"],
      customerAsked: true,
    });
    expect(content.products).toEqual([]);
  });

  it("attributes a cart addition to an earlier suggestion", async () => {
    const { ids, store } = await seedIndustryStore({ widgetKey: "fashion", industry: "fashion", products: FASHION_PRODUCTS });
    const { session } = await tool("fashion", "get_recommendations", { kind: "complete_the_look", productId: ids["Oxford Shirt"], customerAsked: true });
    await addItem({ sessionId: session.sessionId, storeId: store.id, currency: "BDT", productId: ids["Beige Chinos"]!, variantId: null, quantity: 1 });
    const event = await prisma.customerEvent.findFirst({ where: { sessionId: session.sessionId, type: "added_to_cart" } });
    expect(JSON.parse(event!.meta)).toMatchObject({ fromRecommendation: true });
    expect(await prisma.customerEvent.count({ where: { sessionId: session.sessionId, type: "recommendation_shown" } })).toBe(1);
  });
});

describe("suggestion limits and opt-out", () => {
  it("stops unrequested add-ons after the customer opts out, but still answers when asked", async () => {
    const { ids } = await seedIndustryStore({ widgetKey: "fashion", industry: "fashion", products: FASHION_PRODUCTS });
    const session = await newSession("fashion");
    await setSuggestionOptOut({ storeId: session.storeId, sessionId: session.sessionId, visitorId: session.visitorId, optOut: true });

    const unasked = await tool("fashion", "get_recommendations", { kind: "complete_the_look", productId: ids["Oxford Shirt"] }, session);
    expect(unasked.content.suppressed).toBe(true);
    expect(unasked.result.ui).toBeUndefined();

    const asked = await tool("fashion", "get_recommendations", { kind: "complete_the_look", productId: ids["Oxford Shirt"], customerAsked: true }, session);
    expect(asked.content.products.length).toBeGreaterThan(0);

    // Alternatives (not add-ons) are always allowed.
    const similar = await tool("fashion", "get_recommendations", { kind: "similar", productId: ids["Beige Chinos"] }, session);
    expect(similar.content.suppressed).toBeUndefined();
  });

  it("enforces the store's add-on limit per visit", async () => {
    const { ids } = await seedIndustryStore({
      widgetKey: "fashion",
      industry: "fashion",
      products: FASHION_PRODUCTS,
      salesConfig: { recommendation: { maxAddOnsPerConversation: 1 } },
    });
    const session = await newSession("fashion");
    const first = await tool("fashion", "get_recommendations", { kind: "complete_the_look", productId: ids["Oxford Shirt"] }, session);
    expect(first.content.products.length).toBeGreaterThan(0);
    expect((await getEngagementState(session.sessionId)).addOnCount).toBe(1);
    const second = await tool("fashion", "get_recommendations", { kind: "complementary", productId: ids["Oxford Shirt"] }, session);
    expect(second.content.suppressed).toBe(true);
  });
});

describe("configuration per store", () => {
  it("applies each store's own industry, persona and rules", async () => {
    await seedIndustryStore({ widgetKey: "fashion", industry: "fashion", products: FASHION_PRODUCTS });
    await seedIndustryStore({
      widgetKey: "tech",
      industry: "electronics",
      products: ELECTRONICS_PRODUCTS,
      salesConfig: { persona: { role: "Rafi, the gadget guru", personality: "Nerdy and kind." }, conversationRules: ["Always mention the warranty card if the catalog lists one."] },
    });
    const prompt = async (key: string) => {
      const session = await newSession(key);
      const cart = await getCartSummary(session.sessionId, session.storeId, "BDT");
      return buildSystemPromptParts({ session, cart, configuredInstructions: "", enabledFeatures: "" }).stable;
    };
    const fashionPrompt = await prompt("fashion");
    const techPrompt = await prompt("tech");
    expect(fashionPrompt).toContain("a friendly personal stylist");
    expect(fashionPrompt).not.toContain("gadget guru");
    expect(techPrompt).toContain("Rafi, the gadget guru");
    expect(techPrompt).toContain("Always mention the warranty card");
    expect(techPrompt).not.toContain("personal stylist");
  });

  it("falls back to the preset when the stored config is invalid, and keeps legacy category maps", () => {
    const broken = resolveSalesConfig({ salesConfig: JSON.stringify({ industry: "fashion", recommendation: { maxPerReply: 99 } }), recommendationMap: null });
    expect(broken.industry).toBe("fashion");
    expect(broken.recommendation.maxPerReply).toBe(presetConfig("fashion").recommendation.maxPerReply);

    const legacy = resolveSalesConfig({ salesConfig: null, recommendationMap: JSON.stringify({ Backpacks: ["Water bottles"] }) });
    expect(legacy.industry).toBe("general");
    expect(legacy.engagement.enabled).toBe(false);
    expect(legacy.relationships).toEqual(expect.arrayContaining([expect.objectContaining({ from: "backpacks", to: ["water bottles"] })]));
  });

  it("leaves an unconfigured store's behaviour unchanged (no proactive engagement)", () => {
    const config = resolveSalesConfig(null);
    expect(config.industry).toBe("general");
    expect(config.engagement.enabled).toBe(false);
  });
});

describe("compare_products", () => {
  it("compares catalog facts only and rejects products from other stores", async () => {
    const { ids } = await seedIndustryStore({ widgetKey: "tech", industry: "electronics", products: ELECTRONICS_PRODUCTS });
    const other = await seedIndustryStore({ widgetKey: "other", industry: "electronics", products: ELECTRONICS_PRODUCTS });
    const { result } = await tool("tech", "compare_products", { products: [ids["Phone X Silicone Case"], "Phone Y Leather Case"] });
    expect(result.ok).toBe(true);
    const card = result.ui?.[0];
    expect(card?.type).toBe("comparison");
    if (card?.type === "comparison") {
      expect(card.rows.find((row) => row.label === "Price")?.values).toEqual(["1,200 taka", "1,500 taka"]);
      expect(card.rows.find((row) => row.label === "compatible with")?.values).toEqual(["Phone X", "Phone Y"]);
    }
    const foreign = await tool("tech", "compare_products", { products: [ids["Phone X"], other.ids["Phone X Silicone Case"]] });
    expect(foreign.result.ok).toBe(false);
  });
});
