import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { invalidatePricingCache, upsertModelPricing } from "@/modules/ai/pricing.service";
import { listPromptVersions, recordPromptVersion, restorePromptVersion } from "@/modules/ai/prompt-versions.service";
import { buildSystemPromptParts } from "@/modules/ai/system-instructions";
import { emptyUsage } from "@/modules/ai/usage";
import { recordUsage, repriceUnpricedUsage } from "@/modules/analytics/usage.service";
import { getCartSummary } from "@/modules/cart/cart.service";
import {
  appendMessage,
  countInboxFilters,
  listConversations,
  parseInboxFilter,
} from "@/modules/conversations/conversation.service";
import { captureUnansweredQuestion } from "@/modules/knowledge/learning.service";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  invalidatePricingCache();
  fx = await seedFixture();
});

function usage(input: number, output: number) {
  return { ...emptyUsage(), inputTokens: input, outputTokens: output, totalTokens: input + output };
}

describe("usage persistence", () => {
  it("records each event once, rolls it up per conversation, and prices it in USD", async () => {
    await upsertModelPricing({
      providerId: "openai",
      model: "gpt-4o-mini",
      inputPerMillion: 0.15,
      cachedInputPerMillion: 0.075,
      cacheWritePerMillion: 0,
      outputPerMillion: 0.6,
      active: true,
      note: "",
    });
    invalidatePricingCache();
    const session = await newSession();
    const base = {
      storeId: session.storeId,
      conversationId: session.conversationId,
      sessionId: session.sessionId,
      channel: "voice" as const,
      source: "realtime" as const,
      mode: "live" as const,
      providerId: "openai",
      model: "gpt-4o-mini",
      requestKind: "realtime_response" as const,
    };

    const first = await recordUsage({ ...base, eventKey: "realtime:resp_1", usage: usage(1_000_000, 0) });
    // A retried report for the same realtime response must not double count.
    const retry = await recordUsage({ ...base, eventKey: "realtime:resp_1", usage: usage(1_000_000, 0) });
    expect(retry?.id).toBe(first?.id);
    await recordUsage({ ...base, eventKey: "realtime:resp_2", usage: usage(0, 1_000_000) });

    expect(await prisma.aiUsageEvent.count()).toBe(2);
    const summary = await prisma.conversationUsageSummary.findUniqueOrThrow({
      where: { conversationId: session.conversationId },
    });
    expect(summary.eventCount).toBe(2);
    expect(summary.totalTokens).toBe(2_000_000);
    expect(summary.costMicros).toBe(150_000 + 600_000);
    expect(summary.unpricedEventCount).toBe(0);
  });

  it("marks models without pricing as unpriced instead of inventing a cost", async () => {
    const session = await newSession();
    const event = await recordUsage({
      eventKey: "turn:1:0",
      storeId: session.storeId,
      conversationId: session.conversationId,
      sessionId: session.sessionId,
      channel: "text",
      source: "chat",
      mode: "live",
      providerId: "openai",
      model: "some-unpriced-model",
      requestKind: "chat_round",
      usage: usage(500, 50),
    });
    expect(event?.costMicros).toBeNull();
    const summary = await prisma.conversationUsageSummary.findUniqueOrThrow({
      where: { conversationId: session.conversationId },
    });
    expect(summary.unpricedEventCount).toBe(1);
    expect(summary.costMicros).toBe(0);
  });

  it("prices earlier unpriced usage once a price is added, and updates the conversation cost", async () => {
    const session = await newSession();
    await recordUsage({
      eventKey: "realtime:early",
      storeId: session.storeId,
      conversationId: session.conversationId,
      sessionId: session.sessionId,
      channel: "voice",
      source: "realtime",
      mode: "live",
      providerId: "openai",
      model: "gpt-realtime-2",
      requestKind: "realtime_response",
      usage: { ...usage(1_000, 100), audioInputTokens: 1_000, audioOutputTokens: 100 },
      rawUsage: { input_tokens: 1_000, output_tokens: 100, input_token_details: { audio_tokens: 1_000 }, output_token_details: { audio_tokens: 100 } },
    });
    expect(await repriceUnpricedUsage()).toBe(0);

    await upsertModelPricing({
      providerId: "openai",
      model: "gpt-realtime",
      inputPerMillion: 4,
      cachedInputPerMillion: 0.4,
      cacheWritePerMillion: 0,
      outputPerMillion: 16,
      audioInputPerMillion: 32,
      cachedAudioInputPerMillion: 0.4,
      audioOutputPerMillion: 64,
      active: true,
      note: "",
    });
    // "gpt-realtime" matches "gpt-realtime-2" as a prefix.
    expect(await repriceUnpricedUsage()).toBe(1);
    const event = await prisma.aiUsageEvent.findUniqueOrThrow({ where: { eventKey: "realtime:early" } });
    expect(event.pricingStatus).toBe("priced");
    expect(event.costMicros).toBe(1_000 * 32 + 100 * 64);
    const summary = await prisma.conversationUsageSummary.findUniqueOrThrow({ where: { conversationId: session.conversationId } });
    expect(summary.costMicros).toBe(1_000 * 32 + 100 * 64);
    expect(summary.unpricedEventCount).toBe(0);
    expect(summary.pricedEventCount).toBe(1);
  });
});

describe("prompt versions", () => {
  it("versions only real changes and restores an older version as a new one", async () => {
    const storeId = fx.storeA.id;
    expect(await recordPromptVersion({ storeId, content: "" })).toBeNull();
    const v1 = await recordPromptVersion({ storeId, content: "Always mention free gift wrap." });
    expect(v1?.version).toBe(1);
    expect(await recordPromptVersion({ storeId, content: "  Always mention free gift wrap.  " })).toBeNull();
    const v2 = await recordPromptVersion({ storeId, content: "Never promise same-day delivery." });
    expect(v2?.version).toBe(2);

    const restored = await restorePromptVersion({ storeId, versionId: v1!.id });
    expect(restored?.version).toBe(3);
    expect(restored?.content).toBe("Always mention free gift wrap.");
    const settings = await prisma.chatbotSettings.findUniqueOrThrow({ where: { storeId } });
    expect(settings.systemInstructions).toBe("Always mention free gift wrap.");

    const versions = await listPromptVersions(storeId);
    expect(versions.map((version) => version.status)).toEqual(["published", "archived", "archived"]);
  });

  it("can't restore another store's version", async () => {
    const other = await recordPromptVersion({ storeId: fx.storeB.id, content: "Store B rule." });
    expect(await restorePromptVersion({ storeId: fx.storeA.id, versionId: other!.id })).toBeNull();
  });
});

describe("inbox filters", () => {
  it("opens on all chats and separates waiting, unread, AI and resolved", async () => {
    const ids = await Promise.all([newSession(), newSession(), newSession(), newSession()]).then((sessions) =>
      sessions.map((session) => session.conversationId),
    );
    const [waiting, human, unread, closed] = ids;
    for (const id of ids) await appendMessage({ conversationId: id, role: "user", content: "hello" });
    // Opened the widget but never wrote anything: not listed or counted anywhere.
    await newSession();
    await prisma.conversation.update({ where: { id: waiting! }, data: { status: "waiting_human" } });
    await prisma.conversation.update({ where: { id: human! }, data: { status: "human" } });
    await prisma.conversation.update({ where: { id: unread! }, data: { unreadForAdmin: 2 } });
    await prisma.conversation.update({ where: { id: closed! }, data: { status: "closed" } });

    expect(parseInboxFilter(undefined)).toBe("all");
    expect(parseInboxFilter("human")).toBe("attention");
    expect(parseInboxFilter("nonsense")).toBe("all");

    const storeId = fx.storeA.id;
    const counts = await countInboxFilters(storeId);
    expect(counts.all).toBe(4);
    expect(counts.attention).toBe(2);
    expect(counts.unread).toBe(1);
    expect(counts.closed).toBe(1);

    const attention = (await listConversations(storeId, "attention")).map((conversation) => conversation.id).sort();
    expect(attention).toEqual([waiting, human].sort());
    expect((await listConversations(storeId, "unread")).map((conversation) => conversation.id)).toEqual([unread]);
    expect((await listConversations(storeId, "all")).map((conversation) => conversation.id).sort()).toEqual([...ids].sort());
  });

  it("pages through chats, newest first, without overlap", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const session = await newSession();
      await appendMessage({ conversationId: session.conversationId, role: "user", content: `message ${i}` });
      ids.push(session.conversationId);
    }
    const storeId = fx.storeA.id;
    const first = (await listConversations(storeId, "all", 2, 0)).map((conversation) => conversation.id);
    const second = (await listConversations(storeId, "all", 2, 2)).map((conversation) => conversation.id);
    const last = (await listConversations(storeId, "all", 2, 4)).map((conversation) => conversation.id);
    expect(first).toEqual([ids[4], ids[3]]);
    expect(second).toEqual([ids[2], ids[1]]);
    expect(last).toEqual([ids[0]]);
  });
});

describe("knowledge learning switch", () => {
  it("doesn't collect questions when the store turned learning off", async () => {
    await prisma.chatbotSettings.update({ where: { storeId: fx.storeA.id }, data: { knowledgeLearningEnabled: false } });
    await captureUnansweredQuestion({ storeId: fx.storeA.id, question: "Do you ship to Sylhet?" });
    expect(await prisma.unansweredQuestion.count()).toBe(0);

    await prisma.chatbotSettings.update({ where: { storeId: fx.storeA.id }, data: { knowledgeLearningEnabled: true } });
    await captureUnansweredQuestion({ storeId: fx.storeA.id, question: "Do you ship to Sylhet?" });
    expect(await prisma.unansweredQuestion.count()).toBe(1);
  });
});

describe("prompt consolidation", () => {
  it("keeps one version of the recommendation rules when the sales engine is on", async () => {
    const session = await newSession();
    const cart = await getCartSummary(session.sessionId, session.storeId, "BDT");
    const promptWith = (salesConfig: string | null) =>
      buildSystemPromptParts({
        session: { ...session, store: { ...session.store, settings: { ...session.store.settings!, salesConfig } } },
        cart,
        configuredInstructions: "",
        enabledFeatures: "",
      }).stable;

    const engineOn = promptWith(null);
    expect(engineOn).toContain("SALES & ENGAGEMENT");
    expect(engineOn).toContain("SALES PLAYBOOK");
    expect(engineOn).not.toContain("Recommend 1-2 best matches");
    expect(engineOn).toContain("save_customer_profile the moment you get it");

    const engineOff = promptWith(JSON.stringify({ enabled: false }));
    expect(engineOff).not.toContain("SALES & ENGAGEMENT");
    expect(engineOff).toContain("Recommend 1-2 best matches");
  });
});
