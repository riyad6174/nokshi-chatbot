import { beforeEach, describe, expect, it } from "vitest";
import type { AiConfig } from "@/modules/ai/config";
import { getPreset } from "@/modules/ai/presets";
import { runLiveAssistant, type AssistantHistoryMessage, type OrchestratorEvent } from "@/modules/ai/orchestrator";
import { getCartSummary } from "@/modules/cart/cart.service";
import { appendMessage } from "@/modules/conversations/conversation.service";
import { executeTool } from "@/modules/ai/tools";
import { priceLabel } from "@/lib/money";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

// Scored behaviour of the live assistant on the model you use: the right tool, the right product,
// the customer's language, no invented prices, short replies. Skipped without an EVAL_AI_API_KEY.

function evalConfig(): AiConfig | null {
  const apiKey = process.env.EVAL_AI_API_KEY?.trim();
  const model = process.env.EVAL_AI_MODEL?.trim();
  if (!apiKey || !model) return null;
  const preset = getPreset(process.env.EVAL_AI_PROVIDER?.trim() || "openai");
  return {
    providerId: preset.id,
    kind: preset.kind,
    baseUrl: (process.env.EVAL_AI_BASE_URL?.trim() || preset.baseUrl).replace(/\/+$/, ""),
    apiKey,
    model,
    effort: "medium",
  };
}

const config = evalConfig();
let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

type Session = Awaited<ReturnType<typeof newSession>>;

async function turn(session: Session, history: AssistantHistoryMessage[], channel: "text" | "voice" = "text") {
  const cart = await getCartSummary(session.sessionId, session.storeId, "BDT");
  const events: OrchestratorEvent[] = [];
  for await (const event of runLiveAssistant({ session, cart, history, config: config!, channel })) events.push(event);
  const done = events.at(-1) as Extract<OrchestratorEvent, { type: "done" }>;
  const shown = events.flatMap((event) => (event.type === "ui" && event.part.type === "product_list" ? event.part.products.map((product) => product.name) : []));
  return { reply: done.content, tools: (done.toolLog ?? []).map((entry) => entry.name), shown, missed: done.missed };
}

const BANGLA = /[ঀ-৿]/;
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

describe.skipIf(!config)(`assistant accuracy (${config?.model ?? "no model"})`, () => {
  it("searches and shows the matching product for an English request", async () => {
    const result = await turn(await newSession(), [{ role: "user", content: "Do you have backpacks?" }]);
    expect(result.tools).toContain("search_products");
    expect(result.shown).toContain("Trail Backpack");
    expect(BANGLA.test(result.reply)).toBe(false);
    expect(words(result.reply)).toBeLessThanOrEqual(40);
  });

  it("translates a Bangla request into a catalog search and answers in Bangla", async () => {
    const result = await turn(await newSession(), [{ role: "user", content: "আমি একটা ব্যাগ খুঁজছি" }]);
    expect(result.tools).toContain("search_products");
    expect(result.shown.some((name) => name === "Trail Backpack" || name === "Canvas Tote")).toBe(true);
    expect(BANGLA.test(result.reply)).toBe(true);
  });

  it("shows the range for 'what do you have?'", async () => {
    const result = await turn(await newSession(), [{ role: "user", content: "What do you have?" }]);
    expect(result.tools).toContain("search_products");
    expect(result.shown.length).toBeGreaterThan(1);
  });

  it("says so when the store doesn't sell something, without showing unrelated products", async () => {
    const result = await turn(await newSession(), [{ role: "user", content: "Do you sell laptops?" }]);
    expect(result.tools).toContain("search_products");
    expect(result.shown).toEqual([]);
    expect(result.reply.toLowerCase()).not.toMatch(/we have (a |some )?laptops?/);
  });

  it("quotes the real price from the catalog", async () => {
    const result = await turn(await newSession(), [{ role: "user", content: "How much is the Canvas Tote?" }]);
    const label = priceLabel(fx.products.tote.priceMinor, "BDT");
    const digits = (text: string) => text.replace(/[^\d]/g, "");
    expect(digits(result.reply)).toContain(digits(label));
  });

  it("adds a named product straight away", async () => {
    const session = await newSession();
    await turn(session, [{ role: "user", content: "Please add the Canvas Tote to my cart." }]);
    const cart = await getCartSummary(session.sessionId, session.storeId, "BDT");
    expect(cart.items.map((item) => item.name)).toContain("Canvas Tote");
  });

  it("adds 'the second one' from the list on screen", async () => {
    const session = await newSession();
    const shown = await executeTool({ session }, "search_products", JSON.stringify({ query: "tote scarf" }));
    const list = (shown.ui ?? []).find((part) => part.type === "product_list");
    const second = list && list.type === "product_list" ? list.products[1]!.name : "";
    await appendMessage({ conversationId: session.conversationId, role: "assistant", content: "Here are two options.", parts: shown.ui ?? [] });

    await turn(session, [
      { role: "user", content: "show me a tote or a scarf" },
      { role: "assistant", content: `Here are two options.\n[On screen: ${list && list.type === "product_list" ? list.products.map((p, i) => `${i + 1}. ${p.name}`).join(", ") : ""}]` },
      { role: "user", content: "add the second one" },
    ]);
    const cart = await getCartSummary(session.sessionId, session.storeId, "BDT");
    expect(cart.items.map((item) => item.name)).toEqual([second]);
  });

  it("on a voice call, answers the cart question with get_cart in one short sentence", async () => {
    const result = await turn(await newSession(), [{ role: "user", content: "What's in my cart right now?" }], "voice");
    expect(result.tools).toContain("get_cart");
    expect(words(result.reply)).toBeLessThanOrEqual(30);
    expect(result.reply).not.toMatch(/[*#`]/);
  });

  it("asks which version when a product has several in stock", async () => {
    const session = await newSession();
    await turn(session, [{ role: "user", content: "Add the Trail Backpack to my cart" }]);
    const cart = await getCartSummary(session.sessionId, session.storeId, "BDT");
    // Either it asked (nothing added yet) or it picked a version that exists; never a made-up one.
    for (const item of cart.items) expect(["Black", "Olive", "Red"]).toContain(item.variantTitle);
  });
});
