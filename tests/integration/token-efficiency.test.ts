import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderMessage, ProviderStreamEvent, StreamCompletionInput } from "@/modules/ai/provider";
import { newSession, resetDb, seedFixture } from "../helpers/fixtures";

// Token-saving behaviour of the text assistant, with a scripted provider.
const turns: Array<() => ProviderStreamEvent[]> = [];
const calls: ProviderMessage[][] = [];

vi.mock("@/modules/ai/provider", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/ai/provider")>();
  return {
    ...original,
    async *streamCompletion(input: StreamCompletionInput) {
      calls.push(structuredClone(input.messages));
      const next = turns.shift() ?? (() => [{ type: "done", finishReason: "stop", toolCalls: [] } as ProviderStreamEvent]);
      for (const event of next()) yield event;
    },
  };
});

const { runLiveAssistant } = await import("@/modules/ai/orchestrator");
const { getCartSummary } = await import("@/modules/cart/cart.service");

beforeEach(async () => {
  turns.length = 0;
  calls.length = 0;
  await resetDb();
  await seedFixture();
});

const config = { providerId: "gemini", kind: "openai-compatible" as const, baseUrl: "https://ai.test/v1", apiKey: "k", model: "m", effort: "low" as const };

async function run(history: Array<{ role: "user" | "assistant"; content: string }>) {
  const session = await newSession();
  const cart = await getCartSummary(session.sessionId, session.storeId, "BDT");
  const events = [];
  for await (const event of runLiveAssistant({ session, cart, history, config })) events.push(event);
  return events;
}

describe("prompt layout for the provider's cache", () => {
  it("keeps the system message unchanging and puts the turn's context right before the latest message", async () => {
    turns.push(() => [{ type: "delta", text: "Hi!" }, { type: "done", finishReason: "stop", toolCalls: [] }]);
    await run([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hi, how can I help?" },
      { role: "user", content: "show bags" },
    ]);
    const messages = calls[0]!;
    // One unchanging system block first (cacheable), then history, then the turn's context, then the message.
    expect(messages[0]).toMatchObject({ role: "system", cache: true });
    expect(messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "system", "user"]);
    expect(messages[3]).toMatchObject({ role: "system", inline: true });
    expect(String(messages[3]!.content)).toContain("CURRENT CART");
    expect(String(messages[0]!.content)).not.toContain("CURRENT CART");
    expect(messages.at(-1)).toMatchObject({ role: "user", content: "show bags" });
  });
});

describe("one model round less for page-opening tools", () => {
  it("opens the page and replies with a fixed line, without asking the model again", async () => {
    turns.push(() => [
      { type: "done", finishReason: "tool_calls", toolCalls: [{ id: "c1", type: "function", function: { name: "open_product_page", arguments: JSON.stringify({ product: "Trail Backpack" }) } }] },
    ]);
    const events = await run([{ role: "user", content: "open the backpack page" }]);
    expect(calls).toHaveLength(1);
    expect(events.some((event) => event.type === "ui" && event.part.type === "navigate")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "done", content: "Here's its page." });
  });

  it("lets the model handle it when the page can't be opened", async () => {
    turns.push(() => [
      { type: "done", finishReason: "tool_calls", toolCalls: [{ id: "c1", type: "function", function: { name: "open_product_page", arguments: JSON.stringify({ product: "Laptop" }) } }] },
    ]);
    turns.push(() => [{ type: "delta", text: "Which product do you mean?" }, { type: "done", finishReason: "stop", toolCalls: [] }]);
    const events = await run([{ role: "user", content: "open the laptop page" }]);
    expect(calls).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: "done", content: "Which product do you mean?" });
  });
});
