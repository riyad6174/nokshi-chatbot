import { prisma } from "@/lib/db/prisma";
import { isObjectId } from "@/lib/db/ids";
import type { ChatPart } from "@/types/chat";

// Deterministic conversation summaries (no extra model call): what the customer asked about, which
// products were shown, what went into the cart and what happened with orders. Used when a chat is
// longer than the model's history window, and as a digest for agents in the Inbox.

function parts(structured: string | null): ChatPart[] {
  if (!structured) return [];
  try {
    const parsed = JSON.parse(structured) as ChatPart[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

type Row = { role: string; content: string; structuredContent: string | null; createdAt: Date };

export function summarizeRows(rows: Row[]): string {
  const asked: string[] = [];
  const shown = new Set<string>();
  const cart = new Set<string>();
  const events: string[] = [];
  for (const row of rows) {
    if (row.role === "user" && row.content.trim()) asked.push(clip(row.content.trim().replace(/\s+/g, " "), 70));
    if (row.role === "event" && row.content.trim()) events.push(clip(row.content.trim(), 80));
    for (const part of parts(row.structuredContent)) {
      if (part.type === "product_list") for (const product of part.products.slice(0, 4)) shown.add(product.name);
      if (part.type === "cart_summary") for (const item of part.cart.items) cart.add(`${item.quantity}x ${item.name}`);
      if (part.type === "order_confirmation") events.push("An order summary was shown");
    }
  }
  const lines: string[] = [];
  if (asked.length) lines.push(`- Customer asked: ${asked.slice(-6).map((text) => `"${text}"`).join("; ")}`);
  if (shown.size) lines.push(`- Products shown: ${[...shown].slice(-10).join(", ")}`);
  if (cart.size) lines.push(`- Cart at that point: ${[...cart].slice(-6).join(", ")}`);
  if (events.length) lines.push(`- Events: ${events.slice(-4).join("; ")}`);
  return lines.join("\n");
}

/**
 * Summary of the messages older than the latest `windowSize` (the ones the model no longer sees),
 * or "" when the history window already covers the whole conversation.
 */
export async function summarizeEarlierMessages(conversationId: string, windowSize = 20): Promise<string> {
  if (!isObjectId(conversationId)) return "";
  const total = await prisma.message.count({ where: { conversationId, role: { in: ["user", "assistant", "agent"] } } });
  if (total <= windowSize) return "";
  const recent = await prisma.message.findMany({
    where: { conversationId, role: { in: ["user", "assistant", "agent"] } },
    orderBy: { createdAt: "desc" },
    take: windowSize,
    select: { createdAt: true },
  });
  const cutoff = recent[recent.length - 1]?.createdAt;
  if (!cutoff) return "";
  const older = await prisma.message.findMany({
    where: { conversationId, createdAt: { lt: cutoff } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { role: true, content: true, structuredContent: true, createdAt: true },
  });
  return summarizeRows(older.reverse());
}

/** A digest of the whole conversation for agents (Inbox) and handoff notes. */
export async function conversationDigest(conversationId: string): Promise<string> {
  if (!isObjectId(conversationId)) return "";
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { role: true, content: true, structuredContent: true, createdAt: true },
  });
  return summarizeRows(rows.reverse());
}
