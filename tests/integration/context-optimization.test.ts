import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  appendMessage,
  buildProviderHistory,
  getProviderHistoryRows,
  historyCost,
} from "@/modules/conversations/conversation.service";
import { summarizeBeforeCutoff } from "@/modules/conversations/summary.service";
import { compactToolContent } from "@/modules/ai/tools/helpers";
import { getProviderTools } from "@/modules/ai/tools";
import { findCachedKnowledgeAnswer, rememberCachedKnowledgeAnswer } from "@/modules/knowledge/answer-cache.service";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

describe("history token budget", () => {
  it("counts Bangla at its real token weight and keeps versions only for the newest product list", () => {
    expect(historyCost("bag")).toBe(3);
    expect(historyCost("ব্যাগ")).toBe(2 * "ব্যাগ".length);

    const list = (name: string) =>
      JSON.stringify([
        {
          type: "product_list",
          label: "x",
          products: [{ id: `id-${name}`, name, available: true, variants: [{ id: "v1", title: "Red", available: true }] }],
        },
      ]);
    const row = (content: string, structuredContent: string | null, minutes: number) => ({
      role: "assistant",
      content,
      structuredContent,
      attachments: null,
      senderName: null,
      createdAt: new Date(2026, 0, 1, 0, minutes),
    });
    // Newest first, as getProviderHistoryRows returns them.
    const { history } = buildProviderHistory([row("newer", list("Tote"), 2), row("older", list("Scarf"), 1)] as never);
    expect(history[1]!.content).toContain("Tote productId=id-Tote: Red (in stock)");
    expect(history[0]!.content).toContain("Scarf productId=id-Scarf (in stock)");
    expect(history[0]!.content).not.toContain("Red");
  });

  it("keeps the newest messages that fit and reports the oldest included message", async () => {
    const session = await newSession();
    const first = await appendMessage({
      conversationId: session.conversationId,
      role: "user",
      content: "a".repeat(80),
    });
    await appendMessage({ conversationId: session.conversationId, role: "assistant", content: "b".repeat(80) });
    const last = await appendMessage({
      conversationId: session.conversationId,
      role: "user",
      content: "newest",
    });

    const rows = await getProviderHistoryRows(session.conversationId, 20);
    const budgeted = buildProviderHistory(rows, 40);
    expect(budgeted.history).toHaveLength(1);
    expect(budgeted.history[0]?.content).toBe("newest");
    expect(budgeted.cutoff?.getTime()).toBe(last.createdAt.getTime());
    expect(budgeted.cutoff?.getTime()).toBeGreaterThan(first.createdAt.getTime());
  });

  it("extends the cached summary with only messages that fell out of the window", async () => {
    const session = await newSession();
    await appendMessage({ conversationId: session.conversationId, role: "user", content: "first old topic" });
    await appendMessage({ conversationId: session.conversationId, role: "assistant", content: "first old answer" });
    const third = await appendMessage({ conversationId: session.conversationId, role: "user", content: "second old topic" });

    const firstSummary = await summarizeBeforeCutoff(session.conversationId, third.createdAt, null);
    expect(firstSummary).toContain("first old topic");

    await appendMessage({ conversationId: session.conversationId, role: "assistant", content: "second old answer" });
    const fifth = await appendMessage({ conversationId: session.conversationId, role: "user", content: "newly older topic" });
    const cached = await prisma.conversation.findUniqueOrThrow({
      where: { id: session.conversationId },
      select: { contextSummary: true, contextSummaryCutoff: true, contextSummaryUpdatedAt: true },
    });

    const extended = await summarizeBeforeCutoff(session.conversationId, fifth.createdAt, cached);
    expect(extended).toContain("first old topic");
    expect(extended).toContain("second old topic");
    const updated = await prisma.conversation.findUniqueOrThrow({ where: { id: session.conversationId } });
    expect(updated.contextSummaryCutoff?.getTime()).toBe(fifth.createdAt.getTime());
  });
});

describe("tool schema and output compaction", () => {
  it("filters tools by enabled feature but leaves orders and profile tools alone", () => {
    const productOnly = getProviderTools('["product_cards"]').map((tool) => tool.function.name);
    expect(productOnly).toContain("search_products");
    expect(productOnly).not.toContain("add_to_cart");
    expect(productOnly).not.toContain("search_knowledge");
    expect(productOnly).toContain("confirm_order");

    const all = getProviderTools().map((tool) => tool.function.name);
    expect(all).toContain("search_knowledge");
    expect(all).toContain("add_to_cart");
  });

  it("trims long tool strings and huge lists", () => {
    const compact = compactToolContent({
      note: "x".repeat(1_000),
      items: Array.from({ length: 45 }, (_, index) => index),
    }) as { note: string; items: unknown[] };
    expect(compact.note.length).toBe(600);
    expect(compact.items).toHaveLength(41);
    expect(compact.items[40]).toContain("5 more");
  });
});

describe("approved-knowledge answer cache", () => {
  it("stores a strong hit, returns it, and stops returning it when the document is unpublished", async () => {
    const document = await prisma.knowledgeDocument.create({
      data: {
        storeId: fx.storeA.id,
        title: "Delivery time",
        content: "Delivery takes two days inside Dhaka.",
        contentHash: hash("Delivery takes two days inside Dhaka."),
        status: "ready",
        embedding: [],
      },
    });
    await rememberCachedKnowledgeAnswer({
      storeId: fx.storeA.id,
      question: "How long does delivery take?",
      hit: {
        documentId: document.id,
        version: null,
        title: document.title,
        snippet: "Delivery takes two days inside Dhaka.",
        score: 9,
        sourceType: "manual",
      },
    });

    const cached = await findCachedKnowledgeAnswer(fx.storeA.id, "how long does DELIVERY take");
    expect(cached).toEqual({ title: "Delivery time", answer: "Delivery takes two days inside Dhaka." });

    await prisma.knowledgeDocument.update({ where: { id: document.id }, data: { status: "archived" } });
    expect(await findCachedKnowledgeAnswer(fx.storeA.id, "How long does delivery take?")).toBeNull();
  });

  it("does not cache weak matches", async () => {
    const document = await prisma.knowledgeDocument.create({
      data: {
        storeId: fx.storeA.id,
        title: "Warranty",
        content: "One year warranty.",
        contentHash: hash("One year warranty."),
        status: "ready",
        embedding: [],
      },
    });
    await rememberCachedKnowledgeAnswer({
      storeId: fx.storeA.id,
      question: "warranty?",
      hit: {
        documentId: document.id,
        version: null,
        title: document.title,
        snippet: "One year warranty.",
        score: 2,
        sourceType: "manual",
      },
    });
    expect(await findCachedKnowledgeAnswer(fx.storeA.id, "warranty?")).toBeNull();
  });
});
