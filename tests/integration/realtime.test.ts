import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createSessionRoute } from "@/app/api/widget/session/route";
import { POST as realtimeSessionRoute } from "@/app/api/widget/voice/realtime/session/route";
import { POST as realtimeToolRoute } from "@/app/api/widget/voice/realtime/tool/route";
import { POST as realtimeTranscriptRoute } from "@/app/api/widget/voice/realtime/transcript/route";
import { WIDGET_COOKIE } from "@/lib/auth/widget";
import { encryptSecret } from "@/lib/crypto/secrets";
import { prisma } from "@/lib/db/prisma";
import { realtimeTools } from "@/modules/realtime/realtime.service";
import { resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;
let ip = 0;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
  // Store A runs on OpenAI, which is what live voice needs.
  await prisma.chatbotSettings.update({
    where: { storeId: fx.storeA.id },
    data: { provider: "openai", model: "gpt-4.1", aiApiKeyEncrypted: encryptSecret("sk-test-store-key"), aiApiKeyLast4: "-key" },
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function post(path: string, body: unknown, cookie?: string) {
  ip += 1;
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${ip % 250}`, ...(cookie ? { cookie: `${WIDGET_COOKIE}=${cookie}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function openSession() {
  const response = await createSessionRoute(post("/api/widget/session", { widgetKey: "key-a" }));
  return { cookie: response.cookies.get(WIDGET_COOKIE)!.value, body: await response.json() };
}

/** Pretend to be OpenAI's client_secrets endpoint and record what we sent it. */
function mockOpenAi() {
  const sent: Array<{ url: string; auth: string | null; body: Record<string, unknown> }> = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({ value: "ek_test_ephemeral", expires_at: 1_900_000_000 }), { status: 200 });
  }) as typeof fetch;
  return sent;
}

const tool = (cookie: string, name: string, args: unknown, speechAgoMs?: number) =>
  realtimeToolRoute(post("/api/widget/voice/realtime/tool", { name, arguments: JSON.stringify(args), speechAgoMs }, cookie)).then((r) => r.json());

describe("live voice (OpenAI Realtime)", () => {
  it("offers the realtime engine for a store on OpenAI", async () => {
    const { body } = await openSession();
    expect(body.settings.voiceAssistant.engine).toBe("realtime");
  });

  it("mints a short-lived browser token with our instructions and tools, never exposing the store key", async () => {
    const sent = mockOpenAi();
    const { cookie } = await openSession();
    const response = await realtimeSessionRoute(post("/api/widget/voice/realtime/session", {}, cookie));
    const grant = await response.json();
    expect(response.status).toBe(200);
    expect(grant.clientSecret).toBe("ek_test_ephemeral");
    expect(JSON.stringify(grant)).not.toContain("sk-test-store-key");
    expect(grant.opener).toContain("হ্যালো, আমি শুনছি।");

    const call = sent.find((entry) => entry.url.endsWith("/realtime/client_secrets"))!;
    expect(call.auth).toBe("Bearer sk-test-store-key");
    const session = call.body.session as { instructions: string; tools: Array<{ name: string }> };
    expect(session.instructions).toContain("LIVE CALL");
    expect(session.instructions).toContain("Next step toward the order");
    expect(session.tools.map((entry) => entry.name)).toContain("add_to_cart");
  });

  it("refuses without a chat session, or when the store isn't on OpenAI", async () => {
    expect((await realtimeSessionRoute(post("/api/widget/voice/realtime/session", {}))).status).toBe(401);
    await prisma.chatbotSettings.update({ where: { storeId: fx.storeA.id }, data: { aiApiKeyEncrypted: "", provider: "openai-compatible" } });
    const { cookie } = await openSession();
    expect((await realtimeSessionRoute(post("/api/widget/voice/realtime/session", {}, cookie))).status).toBe(403);
  });

  it("runs tools against the store, returns cards and fresh instructions, and keeps the confirm guard", async () => {
    const { cookie } = await openSession();
    const added = await tool(cookie, "add_to_cart", { product: "Handloom Scarf" });
    expect(added.output).toContain("\"ok\":true");
    expect(added.ui[0].type).toBe("cart_summary");
    expect(added.instructions).toContain("Cart has items");

    const details = { name: "Imran Hossain", phone: "জিরো ওয়ান সেভেন নাইন ফোর টু এইট ডাবল থ্রি এইট জিরো", address: "Parbatipur, Dinajpur" };
    const proposed = await tool(cookie, "propose_order", details, 3000);
    expect(proposed.output).toContain("\"ok\":true");
    // "yes" in the same breath as the summary: refused.
    const tooSoon = await tool(cookie, "confirm_order", {}, 3000);
    expect(JSON.parse(tooSoon.output).error.code).toBe("confirmation_required");
    // A new utterance that started after the summary: placed.
    const placed = await tool(cookie, "confirm_order", {}, 0);
    expect(JSON.parse(placed.output).placed).toBe(true);
    expect(await prisma.order.count()).toBe(1);
  });

  it("saves both sides of the call to the chat, with the cards shown and the phone number captured", async () => {
    const { cookie, body } = await openSession();
    const user = await realtimeTranscriptRoute(
      post("/api/widget/voice/realtime/transcript", { role: "user", text: "আমার নাম ইমরান, ফোন জিরো ওয়ান সেভেন নাইন ফোর টু এইট থ্রি থ্রি এইট জিরো" }, cookie),
    ).then((r) => r.json());
    expect(user.message.role).toBe("user");
    expect((await prisma.customerProfile.findFirstOrThrow({ where: { storeId: fx.storeA.id } })).phone).toBe("01794283380");

    await tool(cookie, "search_products", { query: "bag" });
    const reply = await realtimeTranscriptRoute(
      post("/api/widget/voice/realtime/transcript", { role: "assistant", text: "এই ব্যাগগুলো দেখুন।", interrupted: true }, cookie),
    ).then((r) => r.json());
    expect(reply.message.parts.map((part: { type: string }) => part.type)).toContain("product_list");
    const stored = await prisma.message.findFirstOrThrow({ where: { conversationId: body.conversationId, role: "assistant" } });
    expect(stored.content).toBe("এই ব্যাগগুলো দেখুন। (interrupted)");
  });

  it("converts our tool schemas to the realtime format", () => {
    const tools = realtimeTools();
    expect(tools.every((entry) => entry.type === "function" && entry.name && entry.parameters)).toBe(true);
  });
});
