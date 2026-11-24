import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { WIDGET_COOKIE } from "@/lib/auth/widget";
import { encryptSecret } from "@/lib/crypto/secrets";
import { prisma } from "@/lib/db/prisma";
import { resetDb } from "../helpers/fixtures";

// Shared by the voice and text checkups: an in-memory COPY of a real store (catalog, knowledge,
// settings), so test carts and orders never touch real data, and requests through the real routes.

const COLLECTIONS = ["Store", "ChatbotSettings", "Product", "ProductVariant", "KnowledgeDocument"];

/** Copies the store at `sourceUrl` (read-only) into the test database, wired to `geminiKey`. */
export async function copyStore(sourceUrl: string, geminiKey: string) {
  await resetDb();
  const source = new PrismaClient({ datasourceUrl: sourceUrl });
  try {
    for (const name of COLLECTIONS) {
      const result = (await source.$runCommandRaw({ find: name, filter: {}, batchSize: 10_000 })) as { cursor: { firstBatch: unknown[] } };
      const docs = result.cursor.firstBatch;
      if (docs.length) await prisma.$runCommandRaw({ insert: name, documents: docs as never });
    }
  } finally {
    await source.$disconnect();
  }
  // Stored keys are sealed with the real AUTH_SECRET; seal the key again for this run.
  const settings = await prisma.chatbotSettings.findFirstOrThrow();
  await prisma.chatbotSettings.update({
    where: { id: settings.id },
    data: {
      provider: "gemini",
      aiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      aiApiKeyEncrypted: encryptSecret(geminiKey),
      geminiApiKeyEncrypted: encryptSecret(geminiKey),
      voiceEngine: "gemini",
      voiceAssistantEnabled: true,
      handoffEnabled: true,
    },
  });
  return prisma.store.findFirstOrThrow({ include: { settings: true } });
}

/** Sets the reply language (Admin → AI Sales & Engagement) on the copied store. */
export async function setLanguage(language: "bn" | "en" | "auto") {
  const settings = await prisma.chatbotSettings.findFirstOrThrow();
  const sales = JSON.parse(settings.salesConfig || "{}") as Record<string, unknown>;
  await prisma.chatbotSettings.update({ where: { id: settings.id }, data: { salesConfig: JSON.stringify({ ...sales, language }) } });
}

let ipCounter = 0;
/** A request to a widget route, from its own IP (rate limits are per IP and per session). */
export function post(path: string, body: unknown, cookie?: string) {
  ipCounter += 1;
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.77.${Math.floor(ipCounter / 250) % 250}.${ipCounter % 250}`,
      ...(cookie ? { cookie: `${WIDGET_COOKIE}=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

export type TokenTotals = { input: number; cached: number; output: number; reasoning: number; audioIn: number; audioOut: number; requests: number };

export const emptyTotals = (): TokenTotals => ({ input: 0, cached: 0, output: 0, reasoning: 0, audioIn: 0, audioOut: 0, requests: 0 });

export function addTotals(into: TokenTotals, add: Partial<TokenTotals>) {
  for (const key of Object.keys(into) as Array<keyof TokenTotals>) into[key] += add[key] ?? 0;
}

export function formatTotals(totals: TokenTotals): string {
  const all = totals.input + totals.cached + totals.output;
  return `${all.toLocaleString("en-US")} tokens (input ${totals.input.toLocaleString("en-US")}, cached ${totals.cached.toLocaleString("en-US")}, output ${totals.output.toLocaleString("en-US")}${totals.reasoning ? ` incl. thinking ${totals.reasoning.toLocaleString("en-US")}` : ""}${totals.audioIn || totals.audioOut ? `; audio in ${totals.audioIn.toLocaleString("en-US")}, audio out ${totals.audioOut.toLocaleString("en-US")}` : ""}) over ${totals.requests} model responses`;
}
