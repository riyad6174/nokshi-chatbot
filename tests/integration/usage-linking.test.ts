import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderStreamEvent, StreamCompletionInput } from "@/modules/ai/provider";
import { emptyUsage } from "@/modules/ai/usage";
import { resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

// Every model request is tied to the message it produced, so the inbox can show what each reply
// cost: text turns link their rows when the reply is saved; voice links by the browser's reply key,
// whichever of the usage report and the transcript arrives first.

vi.mock("@/modules/ai/provider", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/ai/provider")>();
  return {
    ...original,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async *streamCompletion(_input: StreamCompletionInput) {
      const usage = { ...emptyUsage(), inputTokens: 900, cachedInputTokens: 100, outputTokens: 40, totalTokens: 1040 };
      const events: ProviderStreamEvent[] = [
        { type: "delta", text: "Here you go." },
        { type: "done", finishReason: "stop", toolCalls: [], usage, rawUsage: { prompt_tokens: 1000, completion_tokens: 40 }, providerId: "openai", model: "gpt-4.1" },
      ];
      for (const event of events) yield event;
    },
  };
});

const { POST: createSessionRoute } = await import("@/app/api/widget/session/route");
const { POST: messageRoute } = await import("@/app/api/widget/message/route");
const { POST: usageRoute } = await import("@/app/api/widget/voice/realtime/usage/route");
const { POST: transcriptRoute } = await import("@/app/api/widget/voice/realtime/transcript/route");
const { WIDGET_COOKIE } = await import("@/lib/auth/widget");
const { encryptSecret } = await import("@/lib/crypto/secrets");
const { prisma } = await import("@/lib/db/prisma");

let fx: Fixture;
let ip = 0;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
  await prisma.chatbotSettings.update({
    where: { storeId: fx.storeA.id },
    data: { provider: "openai", model: "gpt-4.1", aiApiKeyEncrypted: encryptSecret("sk-test-store-key"), aiApiKeyLast4: "-key" },
  });
});

function post(path: string, body: unknown, cookie?: string) {
  ip += 1;
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.7.0.${ip % 250}`, ...(cookie ? { cookie: `${WIDGET_COOKIE}=${cookie}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function openSession() {
  const response = await createSessionRoute(post("/api/widget/session", { widgetKey: "key-a" }));
  return { cookie: response.cookies.get(WIDGET_COOKIE)!.value, body: await response.json() };
}

const geminiUsage = {
  promptTokenCount: 1200,
  candidatesTokenCount: 300,
  totalTokenCount: 1500,
  promptTokensDetails: [
    { modality: "TEXT", tokenCount: 1000 },
    { modality: "AUDIO", tokenCount: 200 },
  ],
  responseTokensDetails: [{ modality: "AUDIO", tokenCount: 300 }],
};

describe("usage rows tied to their message", () => {
  it("links a text turn's requests to the saved reply and its turn log", async () => {
    const { cookie, body } = await openSession();
    const response = await messageRoute(post("/api/widget/message", { conversationId: body.conversationId, message: "show me bags" }, cookie));
    await response.text();

    const reply = await prisma.message.findFirstOrThrow({ where: { conversationId: body.conversationId, role: "assistant" } });
    const rows = await prisma.aiUsageEvent.findMany({ where: { conversationId: body.conversationId } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.messageId === reply.id)).toBe(true);
    const turnLog = await prisma.aiTurnLog.findFirstOrThrow({ where: { conversationId: body.conversationId } });
    expect(turnLog.messageId).toBe(reply.id);
    expect(rows.every((row) => row.turnLogId === turnLog.id)).toBe(true);
  });

  it("links a voice usage report that arrives before the reply is saved", async () => {
    const { cookie, body } = await openSession();
    await usageRoute(post("/api/widget/voice/realtime/usage", { kind: "gemini", responseId: "call1-1", model: "gemini-live", usage: geminiUsage, replyKey: "reply-a" }, cookie));
    const before = await prisma.aiUsageEvent.findFirstOrThrow({ where: { conversationId: body.conversationId } });
    expect(before.messageId).toBeNull();
    expect(before.replyKey).toBe("reply-a");

    const saved = await transcriptRoute(
      post("/api/widget/voice/realtime/transcript", { role: "assistant", text: "এই ব্যাগগুলো দেখুন।", replyKey: "reply-a" }, cookie),
    ).then((r) => r.json());
    const after = await prisma.aiUsageEvent.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.messageId).toBe(saved.message.id);
  });

  it("links a voice usage report that arrives after the reply is saved", async () => {
    const { cookie, body } = await openSession();
    const saved = await transcriptRoute(
      post("/api/widget/voice/realtime/transcript", { role: "assistant", text: "আর কিছু লাগবে?", replyKey: "reply-b" }, cookie),
    ).then((r) => r.json());
    await usageRoute(post("/api/widget/voice/realtime/usage", { kind: "gemini", responseId: "call1-2", model: "gemini-live", usage: geminiUsage, replyKey: "reply-b" }, cookie));
    const row = await prisma.aiUsageEvent.findFirstOrThrow({ where: { conversationId: body.conversationId } });
    expect(row.messageId).toBe(saved.message.id);
  });

  it("feeds the inbox report: per message, per session and in total", async () => {
    const { cookie, body } = await openSession();
    await transcriptRoute(post("/api/widget/voice/realtime/transcript", { role: "user", text: "ব্যাগ দেখাও" }, cookie));
    await usageRoute(post("/api/widget/voice/realtime/usage", { kind: "gemini", responseId: "call2-1", model: "gemini-live", usage: geminiUsage, replyKey: "reply-c" }, cookie));
    const saved = await transcriptRoute(
      post("/api/widget/voice/realtime/transcript", { role: "assistant", text: "এই ব্যাগগুলো দেখুন।", replyKey: "reply-c" }, cookie),
    ).then((r) => r.json());

    const { loadConversationObservability } = await import("@/modules/analytics/conversation-observability");
    const messages = await prisma.message.findMany({ where: { conversationId: body.conversationId }, orderBy: { createdAt: "asc" } });
    const report = await loadConversationObservability({ storeId: fx.storeA.id, conversationId: body.conversationId, sessionId: body.sessionId, messages });
    const usage = report.byMessage[saved.message.id]!;
    expect(usage.requests).toHaveLength(1);
    expect(usage.requests[0]!.attribution).toBe("exact");
    expect(usage.totals).toMatchObject({ inputText: 1000, inputAudio: 200, outputAudio: 300, total: 1500 });
    expect(report.sessions).toHaveLength(1);
    expect(report.sessions[0]!.totals.total).toBe(1500);
    expect(report.totals.total).toBe(1500);
  });
});
