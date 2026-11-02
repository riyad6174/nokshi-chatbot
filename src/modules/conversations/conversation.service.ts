import type { Message, MessageAttachment } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isObjectId } from "@/lib/db/ids";
import type { AttachmentData, ChatMessage, ChatPart, ChatRole, ConversationMode } from "@/types/chat";

function parseParts(structuredContent: string | null, fallbackText: string): ChatPart[] {
  if (!structuredContent) return fallbackText ? [{ type: "text", text: fallbackText }] : [];
  try {
    const parsed = JSON.parse(structuredContent) as ChatPart[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [{ type: "text", text: fallbackText }];
    return parsed;
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

/** Text-only history for the model. Staff replies are included so the AI knows what a human already said. */
export async function getProviderHistory(conversationId: string, limit = 20) {
  const rows = await prisma.message.findMany({
    where: { conversationId, role: { in: ["user", "assistant", "agent"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows
    .reverse()
    .map((row) => {
      if (row.role === "user") {
        const extra = describeAttachments(row.attachments, row.content);
        return { role: "user" as const, content: [row.content, extra].filter(Boolean).join("\n") };
      }
      const prefix = row.role === "agent" ? `[Reply from store staff${row.senderName ? ` ${row.senderName}` : ""}] ` : "";
      return { role: "assistant" as const, content: `${prefix}${row.content}` };
    })
    .filter((row) => row.content.trim().length > 0);
}

export type InboxFilter = "attention" | "human" | "bot" | "closed" | "all";

export async function listConversations(storeId: string, filter: InboxFilter = "all", take = 60) {
  const status =
    filter === "attention"
      ? { in: ["waiting_human"] }
      : filter === "human"
        ? { in: ["waiting_human", "human"] }
        : filter === "bot"
          ? { in: ["bot"] }
          : filter === "closed"
            ? { in: ["closed"] }
            : undefined;
  return prisma.conversation.findMany({
    where: { storeId, ...(status ? { status } : {}) },
    orderBy: { lastMessageAt: "desc" },
    take,
    include: {
      session: { select: { visitorId: true, locale: true } },
      _count: { select: { messages: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, role: true, createdAt: true } },
    },
  });
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
