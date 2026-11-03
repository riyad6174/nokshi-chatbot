import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as createSessionRoute } from "@/app/api/widget/session/route";
import { POST as voiceTurnRoute } from "@/app/api/widget/voice/turn/route";
import { POST as confirmOrderRoute } from "@/app/api/widget/orders/confirm/route";
import { GET as greetingRoute } from "@/app/api/widget/voice/greeting/route";
import { WIDGET_COOKIE } from "@/lib/auth/widget";
import { prisma } from "@/lib/db/prisma";
import { executeTool } from "@/modules/ai/tools";
import { addItem } from "@/modules/cart/cart.service";
import { getSessionContext } from "@/modules/conversations/session.service";
import { flagAbandonedCarts } from "@/modules/customers/events.service";
import { resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;
let ipCounter = 0;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

function nextIp() {
  ipCounter += 1;
  return `10.1.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

async function openSession(widgetKey = "key-a") {
  const response = await createSessionRoute(
    new NextRequest("http://localhost:3000/api/widget/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
      body: JSON.stringify({ widgetKey }),
    }),
  );
  const cookie = response.cookies.get(WIDGET_COOKIE)!.value;
  return { cookie, body: await response.json() };
}

function voiceTurn(cookie: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return voiceTurnRoute(
    new NextRequest("http://localhost:3000/api/widget/voice/turn", {
      method: "POST",
      headers: { "x-forwarded-for": nextIp(), cookie: `${WIDGET_COOKIE}=${cookie}` },
      body: form,
    }),
  );
}

function parseSse(text: string) {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? "";
      const data = /^data: (.*)$/m.exec(block)?.[1];
      return { event, data: data ? JSON.parse(data) : null };
    });
}

describe("voice assistant API", () => {
  it("advertises the voice assistant in the session payload", async () => {
    const { body } = await openSession();
    // No OpenAI key in tests: live voice falls back to the cascade engine.
    expect(body.settings.voiceAssistant).toEqual({ enabled: true, speech: "browser", engine: "cascade", maxSessionMinutes: 15 });
  });

  it("answers a spoken turn with the normal reply plus speakable sentences", async () => {
    const { cookie, body } = await openSession();
    const response = await voiceTurn(cookie, {
      conversationId: body.conversationId,
      lang: "en",
      transcript: "Do you have a backpack?",
    });
    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const names = events.map((entry) => entry.event);
    expect(names[0]).toBe("message.started");
    expect(events[0]!.data.transcript).toBe("Do you have a backpack?");
    expect(names).toContain("message.completed");
    expect(names[names.length - 1]).toBe("voice.done");

    const sentences = events.filter((entry) => entry.event === "voice.sentence").map((entry) => entry.data);
    expect(sentences.length).toBeGreaterThan(0);
    expect(sentences.map((sentence) => sentence.seq)).toEqual(sentences.map((_, index) => index));
    // No speech provider in tests: the browser speaks the text itself.
    expect(sentences.every((sentence) => sentence.audio === null && sentence.text.length > 0)).toBe(true);

    const stored = await prisma.message.findMany({ where: { conversationId: body.conversationId, role: "user" } });
    expect(stored.map((message) => message.content)).toEqual(["Do you have a backpack?"]);
    expect(await prisma.customerEvent.count({ where: { type: "voice_turn" } })).toBe(1);
  });

  it("returns 422 when nothing was heard, without storing a message", async () => {
    const { cookie, body } = await openSession();
    const response = await voiceTurn(cookie, { conversationId: body.conversationId, transcript: "   " });
    expect(response.status).toBe(422);
    expect(await prisma.message.count({ where: { role: "user" } })).toBe(0);
  });

  it("asks the customer to repeat when they spoke but weren't understood, and stays quiet for short noises", async () => {
    const { cookie, body } = await openSession();
    const unclear = await voiceTurn(cookie, { conversationId: body.conversationId, lang: "bn", transcript: "", durationMs: "1800" });
    expect(unclear.status).toBe(422);
    const result = await unclear.json();
    expect(result.error.code).toBe("unclear");
    expect(result.speech.text).toBe("দুঃখিত, ঠিক বুঝতে পারিনি। আরেকবার বলবেন?");

    const blip = await voiceTurn(cookie, { conversationId: body.conversationId, transcript: "", durationMs: "300" });
    expect((await blip.json()).error.code).toBe("no_speech");
    expect(await prisma.message.count({ where: { role: "user" } })).toBe(0);
  });

  it("rejects a conversation from another session", async () => {
    const a = await openSession();
    const b = await openSession();
    const response = await voiceTurn(b.cookie, { conversationId: a.body.conversationId, transcript: "hello" });
    expect(response.status).toBe(403);
  });

  it("is off when the store disables the voice assistant", async () => {
    await prisma.chatbotSettings.update({ where: { storeId: fx.storeA.id }, data: { voiceAssistantEnabled: false } });
    const { cookie, body } = await openSession();
    expect(body.settings.voiceAssistant.enabled).toBe(false);
    const response = await voiceTurn(cookie, { conversationId: body.conversationId, transcript: "hello" });
    expect(response.status).toBe(403);
  });

  it("serves the store's own welcome line, never caller-supplied text", async () => {
    await prisma.chatbotSettings.update({
      where: { storeId: fx.storeA.id },
      data: { welcomeVoiceText: JSON.stringify({ en: "Welcome to {store}!" }) },
    });
    const response = await greetingRoute(
      new NextRequest("http://localhost:3000/api/widget/voice/greeting?widgetKey=key-a&lang=en&text=hacked", {
        headers: { "x-forwarded-for": nextIp() },
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({ enabled: true, text: "Welcome to Store A!", audio: null, speech: "browser" });
  });
});

describe("welcome bubble reminders for returning visitors", () => {
  const greeting = (cookie?: string) =>
    greetingRoute(
      new NextRequest("http://localhost:3000/api/widget/voice/greeting?widgetKey=key-a&lang=en&kind=welcome", {
        headers: { "x-forwarded-for": nextIp(), ...(cookie ? { cookie: `${WIDGET_COOKIE}=${cookie}` } : {}) },
      }),
    ).then((response) => response.json());

  it("greets a first-time visitor normally", async () => {
    const body = await greeting();
    expect(body.reminder).toBeNull();
    expect(body.text).toBe("Hello, I'm your voice assistant. Let me know how I can help you.");
  });

  it("reminds a returning visitor of a product they were shown but didn't buy", async () => {
    const { cookie, body: session } = await openSession();
    await prisma.message.create({
      data: {
        conversationId: session.conversationId,
        role: "assistant",
        content: "Here is a backpack",
        structuredContent: JSON.stringify([
          { type: "text", text: "Here is a backpack" },
          { type: "product_list", products: [{ id: fx.products.backpack.id, name: "Trail Backpack", imageUrl: null }] },
        ]),
      },
    });
    const body = await greeting(cookie);
    expect(body.reminder.kind).toBe("product");
    expect(body.text).toBe("Welcome back! Still thinking about the Trail Backpack? I can order it for you right now.");
  });

  it("reminds them of items left in the cart, by name when known", async () => {
    const { cookie, body: session } = await openSession();
    await addItem({ sessionId: session.sessionId, storeId: fx.storeA.id, currency: "BDT", productId: fx.products.scarf.id, quantity: 1 });
    await prisma.customerProfile.create({ data: { storeId: fx.storeA.id, name: "Imran Hossain", visitorIds: [session.visitorId], interests: [] } });
    const body = await greeting(cookie);
    expect(body.reminder.kind).toBe("cart");
    expect(body.text).toBe("Welcome back, Imran! Handloom Scarf is still in your cart. Shall we finish your order?");
  });
});

describe("tap to confirm an order", () => {
  it("places the order shown on the card and returns the order event", async () => {
    const { cookie, body } = await openSession();
    const session = (await getSessionContext(body.sessionId))!;
    await addItem({ sessionId: session.sessionId, storeId: session.storeId, currency: "BDT", productId: fx.products.scarf.id, quantity: 1 });
    const proposed = await executeTool(
      { session, turnStartedAt: new Date() },
      "propose_order",
      JSON.stringify({ name: "Rahim Uddin", phone: "01712345678", address: "House 1, Road 2, Dhanmondi" }),
    );
    const confirmationId = (proposed.content as { confirmationId: string }).confirmationId;

    const response = await confirmOrderRoute(
      new NextRequest("http://localhost:3000/api/widget/orders/confirm", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${WIDGET_COOKIE}=${cookie}` },
        body: JSON.stringify({ confirmationId, voice: true, lang: "en" }),
      }),
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.orderNumber).toMatch(/\w+/);
    expect(result.cart.items).toHaveLength(0);
    expect(result.speech.text).toContain(result.orderNumber);
    expect(result.messages.some((message: { role: string }) => message.role === "event")).toBe(true);
  });
});

describe("abandoned carts", () => {
  it("flags an idle cart once and leaves it active", async () => {
    const { body } = await openSession();
    await addItem({ sessionId: body.sessionId, storeId: fx.storeA.id, currency: "BDT", productId: fx.products.scarf.id, quantity: 1 });
    const threeHoursLater = new Date(Date.now() + 3 * 60 * 60 * 1000);
    expect(await flagAbandonedCarts(threeHoursLater)).toBe(1);
    expect(await flagAbandonedCarts(threeHoursLater)).toBe(0);
    const cart = await prisma.cart.findFirstOrThrow({ where: { sessionId: body.sessionId } });
    expect(cart.status).toBe("active");
  });
});
