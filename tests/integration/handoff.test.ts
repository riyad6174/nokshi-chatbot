import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as messageRoute } from "@/app/api/widget/message/route";
import { POST as sessionRoute } from "@/app/api/widget/session/route";
import { WIDGET_COOKIE } from "@/lib/auth/widget";
import { prisma } from "@/lib/db/prisma";
import {
  agentReply,
  closeConversation,
  recordTurnOutcome,
  releaseToBot,
  requestHandoff,
  wantsHuman,
} from "@/modules/conversations/handoff.service";
import { ensureProductGreeting } from "@/modules/conversations/greeting.service";
import { getSessionContext } from "@/modules/conversations/session.service";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;
let ip = 0;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

function req(path: string, body: unknown, cookie?: string) {
  ip += 1;
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.7.${Math.floor(ip / 250)}.${ip % 250}`,
      ...(cookie ? { cookie: `${WIDGET_COOKIE}=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function open() {
  const response = await sessionRoute(req("/api/widget/session", { widgetKey: "key-a" }));
  return { cookie: response.cookies.get(WIDGET_COOKIE)!.value, body: await response.json() };
}

async function send(cookie: string, conversationId: string, message: string) {
  const response = await messageRoute(req("/api/widget/message", { conversationId, message }, cookie));
  return { status: response.status, text: response.status === 200 ? await response.text() : "" };
}

describe("handoff rules", () => {
  it("matches configured keywords as whole words, including Bangla", () => {
    const keywords = JSON.stringify(["human", "agent", "মানুষ"]);
    expect(wantsHuman("Can I talk to a human?", keywords)).toBe(true);
    expect(wantsHuman("আমি মানুষের সাথে কথা বলতে চাই", keywords)).toBe(true);
    expect(wantsHuman("I need a humane gift idea", keywords)).toBe(false);
  });

  it("hands off after the configured number of consecutive misses, and resets on a good answer", async () => {
    const session = await newSession();
    const base = { storeId: fx.storeA.id, conversationId: session.conversationId, handoffEnabled: true, handoffAfterMisses: 2 };
    expect(await recordTurnOutcome({ ...base, missed: true })).toBe(false);
    expect(await recordTurnOutcome({ ...base, missed: false })).toBe(false);
    expect(await recordTurnOutcome({ ...base, missed: true })).toBe(false);
    expect(await recordTurnOutcome({ ...base, missed: true })).toBe(true);
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: session.conversationId } });
    expect(conversation.status).toBe("waiting_human");
  });
});

describe("human takeover through the API", () => {
  it("a keyword hands off, then the AI stays quiet while the team handles the chat", async () => {
    const { cookie, body } = await open();
    const handoff = await send(cookie, body.conversationId, "I want to talk to a human please");
    expect(handoff.text).toContain('"mode":"waiting_human"');

    const queued = await send(cookie, body.conversationId, "hello? are you there");
    expect(queued.text).toContain('"queued":true');
    expect(queued.text).not.toContain("event: message.delta");

    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: body.conversationId } });
    expect(conversation.unreadForAdmin).toBeGreaterThanOrEqual(2);
  });

  it("agent replies, hands back to the AI, and closing starts a fresh conversation", async () => {
    const { cookie, body } = await open();
    await requestHandoff({ storeId: fx.storeA.id, conversationId: body.conversationId, reason: "test" });
    const admin = await prisma.adminUser.create({ data: { email: "agent@example.com", name: "Nadia", passwordHash: "x" } });

    await agentReply({ storeId: fx.storeA.id, conversationId: body.conversationId, adminId: admin.id, adminName: "Nadia", text: "Hi, Nadia here!" });
    const human = await prisma.conversation.findUniqueOrThrow({ where: { id: body.conversationId } });
    expect(human).toMatchObject({ status: "human", assignedName: "Nadia", unreadForAdmin: 0 });

    await releaseToBot({ storeId: fx.storeA.id, conversationId: body.conversationId, adminName: "Nadia" });
    const botAgain = await send(cookie, body.conversationId, "show me bags");
    expect(botAgain.text).toContain("event: message.delta");

    await closeConversation({ storeId: fx.storeA.id, conversationId: body.conversationId });
    expect((await send(cookie, body.conversationId, "hi")).status).toBe(409);
    const sessionId = (await prisma.conversation.findUniqueOrThrow({ where: { id: body.conversationId } })).sessionId;
    const context = await getSessionContext(sessionId);
    expect(context?.conversationId).not.toBe(body.conversationId);
  });
});

describe("product page greeting", () => {
  it("is sent once per product with a factual overview and the product card", async () => {
    const session = await newSession();
    expect(await ensureProductGreeting(session, fx.products.backpack.id)).toBe(true);
    expect(await ensureProductGreeting(session, fx.products.backpack.id)).toBe(false);
    expect(await ensureProductGreeting(session, "not-an-id")).toBe(false);

    const greeting = await prisma.message.findFirstOrThrow({ where: { conversationId: session.conversationId, role: "assistant" } });
    expect(greeting.content).toContain("Trail Backpack");
    expect(greeting.content).toContain("Available in: Black, Olive");
    expect(greeting.content).not.toContain("Red");
    expect(JSON.parse(greeting.structuredContent!).some((part: { type: string }) => part.type === "product_list")).toBe(true);
  });
});
