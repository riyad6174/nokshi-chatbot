import { prisma } from "@/lib/db/prisma";
import { isObjectId } from "@/lib/db/ids";
import { logger } from "@/lib/logging/logger";
import { appendMessage } from "@/modules/conversations/conversation.service";
import { parseJsonArray } from "@/modules/stores/store.service";

// Conversation modes:
//   bot            the AI replies
//   waiting_human  handed off; the AI stays quiet until an agent joins or releases it
//   human          an agent is replying from the dashboard Inbox
//   closed         finished; the customer's next message starts a new conversation

export class HandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffError";
  }
}

async function loadForStore(storeId: string, conversationId: string) {
  if (!isObjectId(conversationId)) throw new HandoffError("Conversation not found.");
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, storeId } });
  if (!conversation) throw new HandoffError("Conversation not found.");
  return conversation;
}

export async function requestHandoff(input: { storeId: string; conversationId: string; reason: string }) {
  const conversation = await loadForStore(input.storeId, input.conversationId);
  if (conversation.status !== "bot") return conversation;
  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { status: "waiting_human", handoffAt: new Date(), handoffReason: input.reason.slice(0, 300), unreadForAdmin: { increment: 1 } },
  });
  await appendMessage({
    conversationId: conversation.id,
    role: "event",
    content: "Connecting you with our team. Someone will reply here shortly.",
    parts: [
      { type: "text", text: "Connecting you with our team. Someone will reply here shortly." },
      { type: "handoff", state: "waiting" },
    ],
  });
  logger.info("handoff.requested", { conversationId: conversation.id, reason: input.reason.slice(0, 120) });
  return updated;
}

/** Keywords the admin configured ("human", "agent", "মানুষ", ...) trigger an immediate handoff. */
export function wantsHuman(text: string, keywordsJson: string | null | undefined): boolean {
  const keywords = parseJsonArray(keywordsJson).map((keyword) => keyword.trim().toLowerCase()).filter(Boolean);
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => {
    // Whole-word match for latin keywords; substring for scripts without word boundaries (e.g. Bangla).
    if (/^[a-z0-9 ]+$/.test(keyword)) return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(normalized);
    return normalized.includes(keyword);
  });
}

/**
 * Called after each AI turn. A "miss" is a turn that ended without a usable answer (fallback text,
 * refusal or provider failure). After the configured number of consecutive misses, hand off.
 */
export async function recordTurnOutcome(input: {
  storeId: string;
  conversationId: string;
  missed: boolean;
  handoffEnabled: boolean;
  handoffAfterMisses: number;
}) {
  if (!input.missed) {
    await prisma.conversation.update({ where: { id: input.conversationId }, data: { missCount: 0 } });
    return false;
  }
  const updated = await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { missCount: { increment: 1 } },
  });
  if (input.handoffEnabled && input.handoffAfterMisses > 0 && updated.missCount >= input.handoffAfterMisses) {
    await requestHandoff({
      storeId: input.storeId,
      conversationId: input.conversationId,
      reason: `The assistant couldn't answer ${updated.missCount} times in a row.`,
    });
    return true;
  }
  return false;
}

export async function agentTakeOver(input: { storeId: string; conversationId: string; adminId: string; adminName: string }) {
  const conversation = await loadForStore(input.storeId, input.conversationId);
  if (conversation.status === "closed") throw new HandoffError("This conversation is closed.");
  if (conversation.status === "human" && conversation.assignedAdminId === input.adminId) return conversation;
  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { status: "human", assignedAdminId: input.adminId, assignedName: input.adminName, unreadForAdmin: 0 },
  });
  await appendMessage({
    conversationId: conversation.id,
    role: "event",
    content: `${input.adminName} joined the chat.`,
    parts: [
      { type: "text", text: `${input.adminName} joined the chat.` },
      { type: "handoff", state: "joined", agentName: input.adminName },
    ],
  });
  logger.info("handoff.taken_over", { conversationId: conversation.id, adminId: input.adminId });
  return updated;
}

export async function agentReply(input: {
  storeId: string;
  conversationId: string;
  adminId: string;
  adminName: string;
  text: string;
}) {
  const conversation = await loadForStore(input.storeId, input.conversationId);
  if (conversation.status === "closed") throw new HandoffError("This conversation is closed.");
  // Replying is an implicit takeover so the AI doesn't answer over the agent.
  if (conversation.status !== "human" || conversation.assignedAdminId !== input.adminId) {
    await agentTakeOver(input);
  }
  const message = await appendMessage({
    conversationId: conversation.id,
    role: "agent",
    content: input.text,
    senderName: input.adminName,
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { unreadForAdmin: 0 } });
  return message;
}

export async function releaseToBot(input: { storeId: string; conversationId: string; adminName: string }) {
  const conversation = await loadForStore(input.storeId, input.conversationId);
  if (conversation.status === "closed" || conversation.status === "bot") return conversation;
  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { status: "bot", assignedAdminId: null, assignedName: "", missCount: 0, unreadForAdmin: 0 },
  });
  await appendMessage({
    conversationId: conversation.id,
    role: "event",
    content: "You're back with the assistant. Ask me anything.",
    parts: [
      { type: "text", text: "You're back with the assistant. Ask me anything." },
      { type: "handoff", state: "released", agentName: input.adminName },
    ],
  });
  return updated;
}

export async function closeConversation(input: { storeId: string; conversationId: string }) {
  const conversation = await loadForStore(input.storeId, input.conversationId);
  if (conversation.status === "closed") return conversation;
  await appendMessage({
    conversationId: conversation.id,
    role: "event",
    content: "This conversation was closed. Send a message any time to start a new one.",
    parts: [
      { type: "text", text: "This conversation was closed. Send a message any time to start a new one." },
      { type: "handoff", state: "closed" },
    ],
  });
  return prisma.conversation.update({ where: { id: conversation.id }, data: { status: "closed", unreadForAdmin: 0 } });
}

export async function markRead(storeId: string, conversationId: string) {
  if (!isObjectId(conversationId)) return;
  await prisma.conversation.updateMany({ where: { id: conversationId, storeId }, data: { unreadForAdmin: 0 } });
}
