import { createHash } from "node:crypto";
import type { UnansweredQuestion } from "@prisma/client";
import { isObjectId } from "@/lib/db/ids";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";

export type UnansweredOutcome = "answered" | "missed" | "error" | "handoff";
export type UnansweredStatus = "new" | "reviewing" | "answered" | "ignored";

/**
 * Same question, same hash. Lowercasing, removing punctuation and collapsing whitespace keeps
 * "Do you deliver?" and "do you deliver" together without changing the stored wording.
 */
export function normalizeQuestion(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function questionHash(text: string): string {
  return createHash("sha256").update(normalizeQuestion(text)).digest("hex");
}

export function guessLanguage(text: string, fallback = ""): string {
  if (/[\u0980-\u09FF]/.test(text)) return "bn";
  if (/[a-z]/i.test(text)) return "en";
  return fallback;
}

export type CaptureUnansweredInput = {
  storeId: string;
  question: string;
  conversationId?: string | null;
  messageId?: string | null;
  language?: string;
  channel?: "text" | "voice";
  intent?: string;
  outcome?: UnansweredOutcome;
  reason?: string;
};

/**
 * Records a question the assistant could not answer. Upserting by the normalized hash turns
 * repeated misses into one teachable item with an occurrence count.
 */
export async function captureUnansweredQuestion(input: CaptureUnansweredInput): Promise<void> {
  const normalized = normalizeQuestion(input.question);
  if (normalized.length < 3 || !isObjectId(input.storeId)) return;
  // Admin → Knowledge can switch learning off; unset (older stores) means on.
  const settings = await prisma.chatbotSettings
    .findUnique({ where: { storeId: input.storeId }, select: { knowledgeLearningEnabled: true } })
    .catch(() => null);
  if (settings?.knowledgeLearningEnabled === false) return;

  const conversationId =
    input.conversationId && isObjectId(input.conversationId) ? input.conversationId : null;
  const messageId = input.messageId && isObjectId(input.messageId) ? input.messageId : null;
  const now = new Date();

  try {
    await prisma.unansweredQuestion.upsert({
      where: { storeId_questionHash: { storeId: input.storeId, questionHash: questionHash(input.question) } },
      create: {
        storeId: input.storeId,
        conversationId,
        messageId,
        question: input.question.trim().slice(0, 1000),
        normalizedQuestion: normalized,
        questionHash: questionHash(input.question),
        language: input.language ?? guessLanguage(input.question),
        channel: input.channel ?? "text",
        intent: (input.intent ?? "").slice(0, 80),
        outcome: input.outcome ?? "missed",
        reason: (input.reason ?? "").slice(0, 300),
        status: "new",
        occurrences: 1,
        firstAskedAt: now,
        lastAskedAt: now,
      },
      update: {
        question: input.question.trim().slice(0, 1000),
        ...(conversationId ? { conversationId } : {}),
        ...(messageId ? { messageId } : {}),
        language: input.language ?? guessLanguage(input.question),
        channel: input.channel ?? "text",
        intent: (input.intent ?? "").slice(0, 80),
        outcome: input.outcome ?? "missed",
        reason: (input.reason ?? "").slice(0, 300),
        occurrences: { increment: 1 },
        lastAskedAt: now,
      },
    });
  } catch (error) {
    logger.warn("knowledge.unanswered_capture_failed", {
      storeId: input.storeId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function listUnansweredQuestions(
  storeId: string,
  options: { statuses?: UnansweredStatus[]; take?: number } = {},
): Promise<UnansweredQuestion[]> {
  return prisma.unansweredQuestion.findMany({
    where: {
      storeId,
      ...(options.statuses ? { status: { in: options.statuses } } : {}),
    },
    orderBy: [{ lastAskedAt: "desc" }],
    take: options.take ?? 100,
  });
}

export async function updateUnansweredQuestion(input: {
  storeId: string;
  id: string;
  status: UnansweredStatus;
  resolvedKnowledgeId?: string | null;
  resolutionNotes?: string;
}): Promise<boolean> {
  if (!isObjectId(input.storeId) || !isObjectId(input.id)) return false;
  const result = await prisma.unansweredQuestion.updateMany({
    where: { id: input.id, storeId: input.storeId },
    data: {
      status: input.status,
      ...(input.resolvedKnowledgeId !== undefined
        ? {
            resolvedKnowledgeId:
              input.resolvedKnowledgeId && isObjectId(input.resolvedKnowledgeId)
                ? input.resolvedKnowledgeId
                : null,
          }
        : {}),
      ...(input.resolutionNotes !== undefined
        ? { resolutionNotes: input.resolutionNotes.slice(0, 1000) }
        : {}),
    },
  });
  return result.count > 0;
}
