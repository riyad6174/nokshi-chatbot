import type { Message, MessageAttachment } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isObjectId } from "@/lib/db/ids";
import type { AttachmentData, ChatMessage, ChatPart, ChatRole, ConversationMode } from "@/types/chat";

function parseParts(structuredContent: string | null, fallbackText: string): ChatPart[] {
  if (!structuredContent) return fallbackText ? [{ type: "text", text: fallbackText }] : [];
  try {
    const parsed = (JSON.parse(structuredContent) as ChatPart[]);
    if (!Array.isArray(parsed)) return [{ type: "text", text: fallbackText }];
    // Model-only memory, not something to show.
    const visible = parsed.filter((part) => part.type !== "knowledge_sources" && part.type !== "fallback_reply");
    if (visible.length === 0) return [{ type: "text", text: fallbackText }];
    return visible;
  } catch {
    return [{ type: "text", text: fallbackText }];
  }
}

export function attachmentUrl(uploadId: string): string {
  return `/api/widget/uploads/${uploadId}`;
}

function toAttachmentData(attachment: MessageAttachment): AttachmentData {
  return {
    uploadId: attachment.uploadId,
    name: attachment.name,
    mime: attachment.mime,
    size: attachment.size,
    kind: (["image", "audio"].includes(attachment.kind) ? attachment.kind : "file") as AttachmentData["kind"],
    url: attachmentUrl(attachment.uploadId),
    transcript: attachment.transcript ?? null,
    durationMs: attachment.durationMs ?? null,
  };
}

export function toChatMessage(row: Message): ChatMessage {
  const role = (["user", "assistant", "agent", "event"].includes(row.role) ? row.role : "assistant") as ChatRole;
  return {
    id: row.id,
    role,
    parts: role === "user" ? (row.content ? [{ type: "text", text: row.content }] : []) : parseParts(row.structuredContent, row.content),
    attachments: row.attachments.map(toAttachmentData),
    senderName: row.senderName || undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getConversationForSession(conversationId: string, sessionId: string, storeId: string) {
  if (!isObjectId(conversationId)) return null;
  return prisma.conversation.findFirst({
    where: { id: conversationId, sessionId, storeId },
  });
}

export async function appendMessage(input: {
  conversationId: string;
  role: ChatRole;
  content: string;
  parts?: ChatPart[];
  attachments?: MessageAttachment[];
  senderName?: string;
  /** Live voice reply id from the browser (links the reply's usage reports). */
  replyKey?: string;
}) {
  const parts = input.parts ?? (input.content ? [{ type: "text" as const, text: input.content }] : []);
  const structured =
    input.role !== "user" && (parts.length > 1 || parts.some((part) => part.type !== "text")) ? JSON.stringify(parts) : null;

  const message = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      structuredContent: structured,
      attachments: input.attachments ?? [],
      senderName: input.senderName ?? "",
      ...(input.replyKey ? { replyKey: input.replyKey } : {}),
    },
  });

  // Customer messages in a handed-off conversation are unread work for the agents.
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { status: true },
  });
  const countsForAdmin =
    input.role === "user" && (conversation?.status === "waiting_human" || conversation?.status === "human");
  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { lastMessageAt: message.createdAt, ...(countsForAdmin ? { unreadForAdmin: { increment: 1 } } : {}) },
  });
  return message;
}

export async function listConversationMessages(
  conversationId: string,
  options: { limit?: number; after?: Date } = {},
): Promise<ChatMessage[]> {
  if (!isObjectId(conversationId)) return [];
  const rows = await prisma.message.findMany({
    where: { conversationId, ...(options.after ? { createdAt: { gt: options.after } } : {}) },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 80,
  });
  return rows.map(toChatMessage);
}

function describeAttachments(attachments: MessageAttachment[], content: string): string {
  return attachments
    // A spoken turn stores its transcript as the message text too; don't repeat it.
    .filter((attachment) => !(attachment.kind === "audio" && attachment.transcript && attachment.transcript === content))
    .map((attachment) => {
      if (attachment.kind === "audio") {
        return attachment.transcript
          ? `[Voice message, transcribed: "${attachment.transcript}"]`
          : "[Voice message that could not be transcribed]";
      }
      return `[Customer attached ${attachment.kind === "image" ? "an image" : "a file"}: ${attachment.name}]`;
    })
    .join(" ");
}

/**
 * What a reply showed on screen, for the model's memory. Without it, the next turn knows a product
 * was shown but not its id, guesses one, and the cart rejects it ("product not found").
 * Versions are listed by name only: add_to_cart takes the version name, and the ids are long.
 * `brief` (an older list, not the latest one on screen): products and ids only, no versions.
 */
function describeShownParts(structuredContent: string | null, options: { brief?: boolean } = {}): string {
  if (!structuredContent) return "";
  let parts: ChatPart[];
  try {
    parts = JSON.parse(structuredContent) as ChatPart[];
  } catch {
    return "";
  }
  const lines: string[] = [];
  const sources: string[] = [];
  for (const part of parts) {
    if (part.type === "knowledge_sources") {
      for (const source of part.sources.slice(0, 2)) {
        const excerpt = source.excerpt.length > 300 ? `${source.excerpt.slice(0, 300)}...` : source.excerpt;
        sources.push(`- ${source.title}: ${excerpt.replace(/\s+/g, " ")}`);
      }
    } else if (part.type === "product_list") {
      for (const product of part.products.slice(0, 6)) {
        const versions = options.brief
          ? ""
          : product.variants.map((variant) => `${variant.title} (${variant.available ? "in stock" : "sold out"})`).join("; ");
        const stock = product.available ? " (in stock)" : " (sold out)";
        lines.push(`- ${product.name} productId=${product.id}${versions ? `: ${versions}` : stock}`);
      }
    } else if (part.type === "cart_summary") {
      lines.push(`- Cart: ${part.cart.items.map((item) => `${item.quantity}x ${item.name}${item.variantTitle ? ` (${item.variantTitle})` : ""}`).join(", ") || "empty"}`);
    } else if (part.type === "order_confirmation") {
      lines.push("- Order summary card (waiting for the customer's confirmation)");
    } else if (part.type === "comparison") {
      lines.push(`- Comparison of: ${part.products.map((product) => `${product.name} productId=${product.id}`).join("; ")}`);
    } else if (part.type === "suggestion_actions") {
      lines.push("- (This was a proactive suggestion the assistant sent on its own, not an answer to a question.)");
    }
  }
  const shown = lines.length > 0 ? `[On screen with this reply:\n${lines.join("\n")}]` : "";
  const based = sources.length > 0 ? `[Store information this reply used:\n${sources.join("\n")}]` : "";
  return [shown, based].filter(Boolean).join("\n");
}

export type ProviderHistoryRow = Pick<
  Message,
  "role" | "content" | "structuredContent" | "attachments" | "senderName" | "createdAt"
>;

/** The newest model-visible messages, before token budgeting. */
export async function getProviderHistoryRows(conversationId: string, limit = 20): Promise<ProviderHistoryRow[]> {
  if (!isObjectId(conversationId)) return [];
  return prisma.message.findMany({
    where: { conversationId, role: { in: ["user", "assistant", "agent"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      role: true,
      content: true,
      structuredContent: true,
      attachments: true,
      senderName: true,
      createdAt: true,
    },
  });
}

function toHistoryMessage(
  row: ProviderHistoryRow,
  options: { briefShown?: boolean } = {},
): { role: "user" | "assistant"; content: string } {
  if (row.role === "user") {
    const extra = describeAttachments(row.attachments, row.content);
    return { role: "user", content: [row.content, extra].filter(Boolean).join("\n") };
  }
  // The fallback text ("I could not find that…") in the history taught the model to say it again;
  // keep only the fact that this question went unanswered (and any cards that were still shown).
  const fallback = row.role === "assistant" && Boolean(row.structuredContent?.includes('"fallback_reply"'));
  const prefix = row.role === "agent" ? `[Reply from store staff${row.senderName ? ` ${row.senderName}` : ""}] ` : "";
  const text = fallback ? "[No answer was given to this; answer it now if you can.]" : `${prefix}${row.content}`;
  const shown = row.role === "assistant" ? describeShownParts(row.structuredContent, { brief: options.briefShown }) : "";
  return { role: "assistant", content: [text, shown].filter(Boolean).join("\n") };
}

function showsProductList(structuredContent: string | null): boolean {
  return Boolean(structuredContent?.includes('"product_list"'));
}

const BANGLA = /[ঀ-৿]/g;

/**
 * Roughly what a message costs in tokens, in English-character units (about 4 per token). Bangla
 * takes about twice as many tokens per character, so a plain character count let Bangla chats use
 * about twice the intended budget.
 */
export function historyCost(text: string): number {
  return text.length + (text.match(BANGLA)?.length ?? 0);
}

/**
 * Applies a token budget (see historyCost) from the newest message backwards. Only the newest
 * product list on screen keeps its versions; older ones keep names and ids. The returned cutoff is
 * the oldest message included, so older messages can be summarized without querying the recent
 * window again.
 */
export function buildProviderHistory(
  rows: ProviderHistoryRow[],
  // ~1.5k tokens of recent turns; older ones are covered by the stored summary. Every tool round
  // re-sends this, so it is one of the biggest per-turn costs.
  maxChars = 6_000,
): { history: { role: "user" | "assistant"; content: string }[]; cutoff: Date | null } {
  const selected: { role: "user" | "assistant"; content: string; createdAt: Date }[] = [];
  let used = 0;
  let newerList = false;
  for (const row of rows) {
    const lists = row.role === "assistant" && showsProductList(row.structuredContent);
    const message = toHistoryMessage(row, { briefShown: lists && newerList });
    if (lists) newerList = true;
    if (!message.content.trim()) continue;
    const cost = historyCost(message.content);
    if (selected.length > 0 && used + cost > maxChars) break;
    selected.unshift({ ...message, createdAt: row.createdAt });
    used += cost;
  }
  return {
    history: selected.map(({ role, content }) => ({ role, content })),
    cutoff: selected[0]?.createdAt ?? null,
  };
}

/** Text-only history for the model. Staff replies are included so the AI knows what a human already said. */
export async function getProviderHistory(conversationId: string, limit = 20) {
  const rows = await getProviderHistoryRows(conversationId, limit);
  return buildProviderHistory(rows, Number.POSITIVE_INFINITY).history;
}

export type InboxFilter = "all" | "attention" | "unread" | "bot" | "closed";

/** Older links used `human` for chats the team had taken over; they now live under `attention`. */
export function parseInboxFilter(raw: string | undefined | null): InboxFilter {
  if (raw === "human") return "attention";
  return raw === "attention" || raw === "unread" || raw === "bot" || raw === "closed" ? raw : "all";
}

/**
 * Chats in an inbox tab. A chat with no messages at all (the widget was opened, nothing was sent)
 * is left out: there's nothing to read or answer, and opening it showed an empty page.
 */
function inboxWhere(storeId: string, filter: InboxFilter) {
  const base = { storeId, messages: { some: {} } };
  switch (filter) {
    case "attention":
      // Waiting for a person, or a person has taken it over and it isn't resolved yet.
      return { ...base, status: { in: ["waiting_human", "human"] } };
    case "unread":
      return { ...base, unreadForAdmin: { gt: 0 } };
    case "bot":
      return { ...base, status: "bot" };
    case "closed":
      return { ...base, status: "closed" };
    default:
      return base;
  }
}

export async function listConversations(storeId: string, filter: InboxFilter = "all", take = 60, skip = 0) {
  return prisma.conversation.findMany({
    where: inboxWhere(storeId, filter),
    orderBy: { lastMessageAt: "desc" },
    take,
    skip,
    include: {
      session: { select: { visitorId: true, locale: true } },
      _count: { select: { messages: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, role: true, createdAt: true } },
    },
  });
}

export async function countInboxFilters(storeId: string): Promise<Record<InboxFilter, number>> {
  const filters: InboxFilter[] = ["all", "attention", "unread", "bot", "closed"];
  const counts = await Promise.all(filters.map((filter) => prisma.conversation.count({ where: inboxWhere(storeId, filter) })));
  return Object.fromEntries(filters.map((filter, index) => [filter, counts[index] ?? 0])) as Record<InboxFilter, number>;
}

export async function countConversationsNeedingAttention(storeId: string) {
  return prisma.conversation.count({ where: { storeId, status: "waiting_human" } });
}

export async function getConversationDetail(storeId: string, conversationId: string) {
  if (!isObjectId(conversationId)) return null;
  return prisma.conversation.findFirst({
    where: { id: conversationId, storeId },
    include: {
      session: { select: { id: true, visitorId: true, locale: true, createdAt: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
}

export function conversationMode(status: string): ConversationMode {
  return (["bot", "waiting_human", "human", "closed"].includes(status) ? status : "bot") as ConversationMode;
}
