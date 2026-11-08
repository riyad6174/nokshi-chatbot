import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageAttachment } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { ProviderMessage, ProviderStreamEvent, StreamCompletionInput, UserContentPart } from "@/modules/ai/provider";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

const turns: Array<(input: StreamCompletionInput) => ProviderStreamEvent[]> = [];
const calls: ProviderMessage[][] = [];

vi.mock("@/modules/ai/provider", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/ai/provider")>();
  return {
    ...original,
    async *streamCompletion(input: StreamCompletionInput) {
      calls.push(structuredClone(input.messages));
      const next = turns.shift() ?? (() => [{ type: "done", finishReason: "stop", toolCalls: [] }]);
      const events = next(input);
      for (const event of events) yield event;
    },
  };
});

const { runLiveAssistant } = await import("@/modules/ai/orchestrator");
const { ProviderError } = await import("@/modules/ai/provider");
const { getCartSummary } = await import("@/modules/cart/cart.service");

let fx: Fixture;

beforeEach(async () => {
  turns.length = 0;
  calls.length = 0;
  await resetDb();
  fx = await seedFixture();
});

const config = { providerId: "anthropic", kind: "anthropic" as const, baseUrl: "", apiKey: "k", model: "claude-sonnet-5-5", effort: "medium" as const };
const say = (text: string): ProviderStreamEvent[] => [{ type: "delta", text }, { type: "done", finishReason: "stop", toolCalls: [] }];
const toolCall = (name: string, args: unknown, id = `call_${name}`): ProviderStreamEvent => ({
  type: "done",
  finishReason: "tool_calls",
  toolCalls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
});

async function run(session: Awaited<ReturnType<typeof newSession>>, text: string, attachments?: MessageAttachment[]) {
  const cart = await getCartSummary(session.sessionId, session.storeId, "BDT");
  const events = [];
  for await (const event of runLiveAssistant({ session, cart, history: [{ role: "user", content: text }], config, attachments })) events.push(event);
  return events;
}

// Smallest valid PNG header bytes are enough for the type check.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

async function upload(session: Awaited<ReturnType<typeof newSession>>, data: Buffer, mime: string, conversationId: string | null) {
  const row = await prisma.upload.create({
    data: { storeId: session.storeId, sessionId: session.sessionId, conversationId, name: "photo.png", mime, size: data.length, data: new Uint8Array(data) },
  });
  return { uploadId: row.id, name: row.name, mime, size: row.size, kind: mime.startsWith("image/") ? "image" : "file", transcript: null, durationMs: null } as MessageAttachment;
}

describe("AI cannot bypass checkout validation", () => {
  it("can't propose and place an order in the same turn, even if the model tries", async () => {
    const session = await newSession();
    await prisma.customerProfile.create({
      data: { storeId: session.storeId, visitorIds: [session.visitorId], interests: [], name: "Rahim", phone: "01712345678", phoneKey: "1712345678", address: "House 4, Road 2, Dhanmondi" },
    });
    turns.push(() => [toolCall("add_to_cart", { productId: fx.products.scarf.id })]);
    turns.push(() => [toolCall("propose_order", {})]);
    turns.push(() => [toolCall("confirm_order", {})]);
    turns.push(() => say("Placed!"));
    const events = await run(session, "buy the scarf and place the order");
    const done = events.at(-1) as { toolLog?: Array<{ name: string; ok: boolean }> };
    expect(done.toolLog?.find((entry) => entry.name === "confirm_order")?.ok).toBe(false);
    expect(await prisma.order.count({ where: { storeId: session.storeId } })).toBe(0);
  });

  it("can't add another store's product even with a smuggled store id", async () => {
    const session = await newSession();
    turns.push(() => [toolCall("add_to_cart", { productId: fx.products.foreign.id, storeId: fx.storeB.id })]);
    turns.push(() => say("Added."));
    const events = await run(session, "add the foreign backpack");
    const done = events.at(-1) as { toolLog?: Array<{ name: string; ok: boolean; code: string }> };
    expect(done.toolLog?.[0]).toMatchObject({ name: "add_to_cart", ok: false, code: "product_not_found" });
    expect((await getCartSummary(session.sessionId, session.storeId, "BDT")).items).toHaveLength(0);
  });
});

describe("image and document understanding", () => {
  it("sends the current message's image to the model, framed as untrusted customer data", async () => {
    const session = await newSession();
    const attachment = await upload(session, PNG, "image/png", session.conversationId);
    turns.push(() => say("Nice shirt!"));
    await run(session, "find pants that match this", [attachment]);
    const user = calls[0]!.at(-1) as { role: "user"; content: UserContentPart[] };
    expect(Array.isArray(user.content)).toBe(true);
    expect(user.content.find((part) => part.type === "image")).toMatchObject({ mime: "image/png" });
    const note = user.content.find((part) => part.type === "text" && part.text.includes("customer-provided data"));
    expect(note).toBeDefined();
  });

  it("ignores uploads from another conversation and files whose bytes don't match their type", async () => {
    const session = await newSession();
    const other = await newSession();
    const foreign = await upload(other, PNG, "image/png", other.conversationId);
    const fake = await upload(session, Buffer.from("<script>alert(1)</script>"), "image/png", session.conversationId);
    turns.push(() => say("ok"));
    await run(session, "look", [foreign, fake]);
    const user = calls[0]!.at(-1)!;
    const parts = Array.isArray(user.content) ? (user.content as UserContentPart[]) : [];
    expect(parts.some((part) => part.type === "image")).toBe(false);
  });

  it("can be turned off per store", async () => {
    const session = await newSession();
    await prisma.chatbotSettings.update({ where: { storeId: session.storeId }, data: { salesConfig: JSON.stringify({ features: { attachmentUnderstanding: false } }) } });
    const fresh = { ...session, store: (await prisma.store.findUniqueOrThrow({ where: { id: session.storeId }, include: { settings: true } })) };
    const attachment = await upload(session, PNG, "image/png", session.conversationId);
    turns.push(() => say("ok"));
    await run(fresh, "look", [attachment]);
    expect(typeof calls[0]!.at(-1)!.content).toBe("string");
  });

  it("falls back to text when the model rejects images", async () => {
    const session = await newSession();
    const attachment = await upload(session, PNG, "image/png", session.conversationId);
    turns.push(() => {
      throw new ProviderError("image input not supported", 400);
    });
    turns.push(() => say("I can't open photos here; could you describe it?"));
    const events = await run(session, "what is this?", [attachment]);
    expect(events.at(-1)).toMatchObject({ type: "done", content: "I can't open photos here; could you describe it?" });
    expect(typeof calls[1]!.at(-1)!.content).toBe("string");
    expect(calls[1]!.at(-1)!.content).toContain("can't read files");
  });
});
