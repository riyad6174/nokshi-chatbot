import { isObjectId } from "@/lib/db/ids";
import { prisma } from "@/lib/db/prisma";
import { normalizeQuestion, questionHash } from "@/modules/knowledge/learning.service";
import type { KnowledgeHit } from "@/modules/knowledge/retrieval.service";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type CachedKnowledgeAnswer = {
  title: string;
  answer: string;
};

/**
 * Exact-question cache for approved knowledge. It is only consulted when the store explicitly turns
 * answerCacheEnabled on, and only for standalone policy questions (no cart or open order).
 */
export async function findCachedKnowledgeAnswer(
  storeId: string,
  question: string,
): Promise<CachedKnowledgeAnswer | null> {
  if (!isObjectId(storeId) || normalizeQuestion(question).length < 3) return null;
  const entry = await prisma.answerCacheEntry.findUnique({
    where: { storeId_questionHash: { storeId, questionHash: questionHash(question) } },
    include: { knowledgeDocument: { select: { title: true, status: true } } },
  });
  if (!entry || entry.knowledgeDocument.status !== "ready") return null;
  if (entry.expiresAt && entry.expiresAt.getTime() <= Date.now()) return null;

  await prisma.answerCacheEntry
    .update({
      where: { id: entry.id },
      data: { hitCount: { increment: 1 }, lastUsedAt: new Date() },
    })
    .catch(() => undefined);
  return { title: entry.knowledgeDocument.title, answer: entry.answer };
}

/** Remembers a high-confidence knowledge hit. Weak matches are never cached. */
export async function rememberCachedKnowledgeAnswer(input: {
  storeId: string;
  question: string;
  hit: KnowledgeHit;
}): Promise<void> {
  const normalized = normalizeQuestion(input.question);
  if (
    normalized.length < 3 ||
    !isObjectId(input.storeId) ||
    !isObjectId(input.hit.documentId) ||
    input.hit.score < 8
  ) {
    return;
  }
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
  const answer = input.hit.snippet.slice(0, 360);
  const hash = questionHash(input.question);
  await prisma.answerCacheEntry
    .upsert({
      where: { storeId_questionHash: { storeId: input.storeId, questionHash: hash } },
      create: {
        storeId: input.storeId,
        knowledgeDocumentId: input.hit.documentId,
        knowledgeVersion: input.hit.version,
        questionHash: hash,
        normalizedQuestion: normalized,
        question: input.question.trim().slice(0, 1000),
        answer,
        embedding: [],
        expiresAt,
      },
      update: {
        knowledgeDocumentId: input.hit.documentId,
        knowledgeVersion: input.hit.version,
        normalizedQuestion: normalized,
        question: input.question.trim().slice(0, 1000),
        answer,
        embedding: [],
        expiresAt,
      },
    })
    .catch(() => undefined);
}
