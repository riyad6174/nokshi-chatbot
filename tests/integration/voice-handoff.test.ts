import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as createSessionRoute } from "@/app/api/widget/session/route";
import { POST as toolRoute } from "@/app/api/widget/voice/realtime/tool/route";
import { WIDGET_COOKIE } from "@/lib/auth/widget";
import { encryptSecret } from "@/lib/crypto/secrets";
import { prisma } from "@/lib/db/prisma";
import { appendMessage } from "@/modules/conversations/conversation.service";
import { resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;
let ip = 0;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
  // Live voice (Gemini) for store A.
  await prisma.chatbotSettings.update({
    where: { storeId: fx.storeA.id },
    data: { voiceEngine: "gemini", geminiApiKeyEncrypted: encryptSecret("gemini-test-key"), handoffEnabled: true },
  });
});

function post(path: string, body: unknown, cookie?: string) {
  ip += 1;
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.8.0.${ip % 250}`, ...(cookie ? { cookie: `${WIDGET_COOKIE}=${cookie}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function callWith(lines: Array<["user" | "assistant", string]>) {
  const response = await createSessionRoute(post("/api/widget/session", { widgetKey: "key-a" }));
  const cookie = response.cookies.get(WIDGET_COOKIE)!.value;
  const { conversationId } = (await response.json()) as { conversationId: string };
  for (const [role, content] of lines) await appendMessage({ conversationId, role, content });
  const result = await toolRoute(post("/api/widget/voice/realtime/tool", { name: "request_human", arguments: JSON.stringify({ reason: "Wants to cancel an order" }) }, cookie));
  const output = JSON.parse(((await result.json()) as { output: string }).output) as { ok: boolean; error?: { code: string } };
  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  return { output, status: conversation.status };
}

describe("asking for a person on a voice call", () => {
  it("hands off when they ask for the team (টিম), even with a stray noise line after it", async () => {
    const { output, status } = await callWith([
      ["user", "তোমার টিমের সাথে আমি কথা বলতে চাই সরাসরি।"],
      ["user", "la"],
    ]);
    expect(output.ok).toBe(true);
    expect(status).toBe("waiting_human");
  });

  it("hands off when they say yes to the assistant's own offer", async () => {
    const { output } = await callWith([
      ["user", "আমার অর্ডারটা ক্যানসেল করব।"],
      ["assistant", "আমি সরাসরি অর্ডার ক্যানসেল করতে পারি না, আমাদের টিমের সাথে কথা বলাবো?"],
      ["user", "হ্যাঁ, বলো।"],
    ]);
    expect(output.ok).toBe(true);
  });

  it("still keeps the call when nobody asked for a person", async () => {
    const { output } = await callWith([["user", "ব্যাগ দেখান"]]);
    expect(output.ok).toBe(false);
    expect(output.error?.code).toBe("not_requested");
  });

  it("understands English requests again (the word-boundary bug)", async () => {
    const { output } = await callWith([["user", "Can I talk to a human please?"]]);
    expect(output.ok).toBe(true);
  });
});
