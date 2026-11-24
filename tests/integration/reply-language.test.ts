import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { buildSystemPromptParts } from "@/modules/ai/system-instructions";
import { openerInstruction, pickWaitFiller, realtimeInstructions, WAIT_FILLERS } from "@/modules/realtime/realtime.service";
import { resolveSalesConfig } from "@/modules/sales/config";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

async function sessionWithLanguage(language: "bn" | "en" | "auto") {
  const settings = await prisma.chatbotSettings.findUniqueOrThrow({ where: { storeId: fx.storeA.id } });
  const config = { ...resolveSalesConfig(settings), language };
  await prisma.chatbotSettings.update({ where: { storeId: fx.storeA.id }, data: { salesConfig: JSON.stringify(config) } });
  return newSession("key-a");
}

const emptyCart = (currency: string) => ({ items: [], subtotalMinor: 0, currency, itemCount: 0 }) as never;

describe("the language chosen in admin", () => {
  it("Bangla: always Bangla, even when the customer's last message was English", async () => {
    const session = await sessionWithLanguage("bn");
    const { stable, perTurn } = buildSystemPromptParts({
      session,
      cart: emptyCart(session.store.currency),
      configuredInstructions: "",
      enabledFeatures: null,
      replyLanguage: "en",
    });
    expect(stable).toContain("ALWAYS reply in Bangla");
    expect(stable).not.toContain("treat that as English");
    expect(perTurn).toContain("Reply in Bangla (বাংলা)");
  });

  it("English: always English, with an English greeting and English fillers on calls", async () => {
    const session = await sessionWithLanguage("en");
    const { stable, perTurn } = buildSystemPromptParts({
      session,
      cart: emptyCart(session.store.currency),
      configuredInstructions: "",
      enabledFeatures: null,
      replyLanguage: "bn",
    });
    expect(stable).toContain("ALWAYS reply in English");
    expect(perTurn).toContain("Reply in English");
    const call = await realtimeInstructions(session);
    expect(call).toContain("speak ONLY English");
    expect(WAIT_FILLERS.some((filler) => call.includes(`"${filler}"`))).toBe(false);
    expect(openerInstruction(null, "en")).toContain("How can I help you today?");
    expect(WAIT_FILLERS).not.toContain(pickWaitFiller("c1", Math.random, "en"));
  });

  it("Match the customer: mixed Bangla-English stays Bangla", async () => {
    const session = await sessionWithLanguage("auto");
    const { stable, perTurn } = buildSystemPromptParts({
      session,
      cart: emptyCart(session.store.currency),
      configuredInstructions: "",
      enabledFeatures: null,
      replyLanguage: "bn",
    });
    expect(stable).toContain("Bangla with English words mixed in");
    expect(perTurn).toContain("Reply in Bangla (বাংলা)");
    const call = await realtimeInstructions(session);
    expect(call).toContain("Bangla mixed with English words is Bangla");
  });
});
