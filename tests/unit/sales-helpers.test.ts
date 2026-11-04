import { describe, expect, it } from "vitest";
import { computeAnalytics } from "@/modules/analytics/analytics.service";
import { translateShoppingTerms } from "@/modules/catalog/query-terms";
import { FormatError, formatRelationships, parseMap, parseRecipes, parseRelationships } from "@/modules/sales/admin-format";
import { detectShoppingIntent } from "@/modules/sales/intent";
import { singular, termMatches } from "@/modules/sales/matching";
import { mergeConfig } from "@/modules/sales/config";

describe("term matching", () => {
  it("is singular/plural and spelling tolerant", () => {
    expect(singular("Potatoes")).toBe("potato");
    expect(singular("Shoes")).toBe("shoe");
    expect(termMatches("green chili", "Green Chilies 250g")).toBe(true);
    expect(termMatches("chili", "Red chilli powder")).toBe(true);
    expect(termMatches("Shirts", "Oxford Shirt")).toBe(true);
    expect(termMatches("pants", "Oxford Shirt")).toBe(false);
  });
});

describe("shopping intent", () => {
  it("recognises opt-out in English, Bangla and Banglish", () => {
    expect(detectShoppingIntent({ text: "please stop suggesting things", cartItemCount: 0 }).optOut).toBe(true);
    expect(detectShoppingIntent({ text: "no more recommendations", cartItemCount: 0 }).optOut).toBe(true);
    expect(detectShoppingIntent({ text: "আর সাজেস্ট করবেন না", cartItemCount: 0 }).optOut).toBe(true);
    expect(detectShoppingIntent({ text: "r suggest korben na", cartItemCount: 0 }).optOut).toBe(true);
    expect(detectShoppingIntent({ text: "what goes well with this shirt?", cartItemCount: 0 }).wantsSuggestions).toBe(true);
  });

  it("classifies the shopping stage", () => {
    expect(detectShoppingIntent({ text: "which is better, A vs B?", cartItemCount: 0 }).stage).toBe("comparing");
    expect(detectShoppingIntent({ text: "too expensive, anything cheaper?", cartItemCount: 1 }).stage).toBe("price_sensitive");
    expect(detectShoppingIntent({ text: "ok place the order", cartItemCount: 1 }).stage).toBe("ready_to_buy");
    expect(detectShoppingIntent({ text: "where is my order? I want a refund", cartItemCount: 0 }).stage).toBe("support");
    expect(detectShoppingIntent({ text: "hmm not sure", cartItemCount: 0 }).stage).toBe("undecided");
  });
});

describe("Banglish and synonyms", () => {
  it("maps Banglish words and store synonyms to catalog terms", () => {
    expect(translateShoppingTerms("aloo r piyaj lagbe")).toBe("potato onion");
    expect(translateShoppingTerms("ভালো জুতা")).toBe("shoes");
    expect(translateShoppingTerms("gift box please", { "gift box": ["hamper"] })).toBe("hamper");
    // Whole words only: "dimension" isn't "dim" (egg).
    expect(translateShoppingTerms("dimension")).toBe("");
  });
});

describe("admin line formats", () => {
  it("round-trips relationships and reports bad lines", () => {
    const rules = parseRelationships("Shirts -> Pants, Belts | complete_the_look | {to} completes it\n# comment\nPhones -> Cases");
    expect(rules).toEqual([
      { from: "Shirts", to: ["Pants", "Belts"], kind: "complete_the_look", reason: "{to} completes it" },
      { from: "Phones", to: ["Cases"], kind: "complementary", reason: "" },
    ]);
    expect(parseRelationships(formatRelationships(rules))).toEqual(rules);
    expect(() => parseRelationships("Shirts Pants")).toThrow(FormatError);
    expect(() => parseRelationships("A -> B | teleport")).toThrow(/kind must be/);
    expect(parseRecipes("dal: lentil, onion")).toEqual([{ name: "dal", ingredients: ["lentil", "onion"] }]);
    expect(parseMap("White: beige, navy", "x")).toEqual({ white: ["beige", "navy"] });
  });

  it("merges saved overrides onto presets (arrays replace, objects merge)", () => {
    expect(mergeConfig({ a: { b: 1, c: 2 }, list: [1, 2] }, { a: { c: 3 }, list: [9] })).toEqual({ a: { b: 1, c: 3 }, list: [9] });
  });
});

describe("analytics", () => {
  const at = new Date();
  const event = (type: string, sessionId: string, meta: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
    type,
    sessionId,
    productId: null,
    cartId: null,
    meta: JSON.stringify(meta),
    at,
    valueMinor: null,
    ...extra,
  });

  it("computes conversion, recommendation attribution, recovery and gaps", () => {
    const result = computeAnalytics({
      events: [
        event("searched", "s1", { query: "Shirt", matched: true }),
        event("searched", "s2", { query: "kite", matched: false }),
        event("searched", "s2", { scope: "knowledge", query: "warranty", matched: false }),
        event("recommendation_shown", "s1", { productIds: ["p2"] }),
        event("added_to_cart", "s1", { fromRecommendation: true }),
        event("added_to_cart", "s3", {}),
        event("checkout_started", "s1"),
        event("order_placed", "s1", { productIds: ["p1", "p2"] }, { cartId: "c1", valueMinor: 50000 }),
        event("abandoned_cart", "s1", {}, { cartId: "c1" }),
        event("abandoned_cart", "s3", {}, { cartId: "c3" }),
      ],
      turns: [
        { outcome: "answered", latencyMs: 1000, firstTokenMs: 300, toolCalls: [{ name: "search_products", ok: true, code: "" }], userText: "hi", at, channel: "text" },
        { outcome: "missed", latencyMs: 3000, firstTokenMs: null, toolCalls: [{ name: "add_to_cart", ok: false, code: "out_of_stock" }], userText: "do you ship to Sylhet?", at, channel: "voice" },
      ],
    });
    expect(result.search).toMatchObject({ sessions: 2, purchased: 1, conversion: 0.5 });
    expect(result.recommendations).toMatchObject({ shown: 1, addedToCart: 1, purchased: 1 });
    expect(result.funnel).toMatchObject({ cartSessions: 2, orderSessions: 1, cartToOrder: 0.5 });
    expect(result.abandoned).toMatchObject({ carts: 2, recovered: 1, recoveryRate: 0.5 });
    expect(result.ai).toMatchObject({ turns: 2, answered: 1, missed: 1, successRate: 0.5, toolErrors: 1, voiceTurns: 1 });
    expect(result.ai.topToolErrors[0]).toEqual({ value: "add_to_cart: out_of_stock", count: 1 });
    expect(result.gaps.missingProducts).toEqual([{ value: "kite", count: 1 }]);
    expect(result.gaps.missingKnowledge).toEqual([{ value: "warranty", count: 1 }]);
    expect(result.gaps.unanswered[0]?.text).toBe("do you ship to Sylhet?");
    expect(result.sales).toMatchObject({ orders: 1, revenueMinor: 50000 });
  });
});
