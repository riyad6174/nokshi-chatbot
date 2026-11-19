import type { KnowledgeEntryVersion } from "@prisma/client";
import { isObjectId } from "@/lib/db/ids";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import { refreshKnowledgeEmbeddings } from "@/modules/search/embeddings.service";

export type KnowledgeVersionStatus = "draft" | "published" | "archived";

export async function listKnowledgeVersions(
  storeId: string,
  documentId: string,
): Promise<KnowledgeEntryVersion[]> {
  if (!isObjectId(documentId)) return [];
  return prisma.knowledgeEntryVersion.findMany({
    where: { storeId, knowledgeDocumentId: documentId },
    orderBy: { version: "desc" },
  });
}

/**
 * Snapshots the document as it currently stands. Versions are immutable, so publishing an older
 * snapshot can safely bring back its exact title/content.
 */
export async function snapshotKnowledgeVersion(input: {
  storeId: string;
  documentId: string;
  status: KnowledgeVersionStatus;
  createdBy?: string;
}): Promise<KnowledgeEntryVersion | null> {
  if (!isObjectId(input.storeId) || !isObjectId(input.documentId)) return null;
  const document = await prisma.knowledgeDocument.findFirst({
    where: { id: input.documentId, storeId: input.storeId },
  });
  if (!document) return null;

  const latest = await prisma.knowledgeEntryVersion.findFirst({
    where: { knowledgeDocumentId: document.id },
    orderBy: { version: "desc" },
  });

  // Saving without changing the content should not add noise to the history.
  if (
    latest &&
    latest.title === document.title &&
    latest.content === document.content &&
    latest.status === input.status &&
    (latest.category ?? null) === (document.category ?? null) &&
    (latest.locale ?? null) === (document.locale ?? null)
  ) {
    return latest;
  }

  return prisma.knowledgeEntryVersion.create({
    data: {
      storeId: input.storeId,
      knowledgeDocumentId: document.id,
      version: (latest?.version ?? 0) + 1,
      title: document.title,
      content: document.content,
      contentHash: document.contentHash,
      category: document.category,
      keywords: document.keywords ?? "[]",
      relatedQuestions: document.relatedQuestions ?? "[]",
      locale: document.locale,
      sourceType: document.sourceType,
      sourceReference: document.sourceReference,
      status: input.status,
      createdBy: input.createdBy ?? "",
      publishedAt: input.status === "published" ? new Date() : null,
    },
  });
}

export async function publishKnowledgeVersion(input: {
  storeId: string;
  documentId: string;
  versionId: string;
  createdBy?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (![input.storeId, input.documentId, input.versionId].every(isObjectId)) {
    return { ok: false, error: "Document or version not found." };
  }
  const [document, version] = await Promise.all([
    prisma.knowledgeDocument.findFirst({ where: { id: input.documentId, storeId: input.storeId } }),
    prisma.knowledgeEntryVersion.findFirst({
      where: { id: input.versionId, knowledgeDocumentId: input.documentId, storeId: input.storeId },
    }),
  ]);
  if (!document || !version) return { ok: false, error: "Document or version not found." };

  const publishedAt = new Date();
  await prisma.$transaction([
    prisma.knowledgeEntryVersion.updateMany({
      where: { knowledgeDocumentId: document.id, status: "published", id: { not: version.id } },
      data: { status: "archived" },
    }),
    prisma.knowledgeEntryVersion.update({
      where: { id: version.id },
      data: { status: "published", publishedAt },
    }),
    prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: {
        title: version.title,
        content: version.content,
        contentHash: version.contentHash,
        category: version.category,
        keywords: version.keywords,
        relatedQuestions: version.relatedQuestions,
        locale: version.locale,
        sourceType: version.sourceType,
        sourceReference: version.sourceReference,
        status: "ready",
        version: version.version,
        publishedAt,
        lastReviewedAt: publishedAt,
        embedding: [],
        embeddingHash: null,
      },
    }),
    prisma.answerCacheEntry.deleteMany({
      where: { storeId: input.storeId, knowledgeDocumentId: document.id },
    }),
  ]);

  // Embeddings are optional. Refreshing in the background keeps publishing fast and still makes
  // the new text available to semantic search when the provider is configured.
  void refreshKnowledgeEmbeddings(input.storeId).catch((error) => {
    logger.warn("knowledge.embedding_refresh_failed", {
      storeId: input.storeId,
      documentId: input.documentId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return { ok: true };
}

export async function archiveKnowledgeDocument(input: {
  storeId: string;
  documentId: string;
}): Promise<boolean> {
  if (!isObjectId(input.storeId) || !isObjectId(input.documentId)) return false;
  const result = await prisma.knowledgeDocument.updateMany({
    where: { id: input.documentId, storeId: input.storeId },
    data: { status: "archived" },
  });
  if (result.count === 0) return false;
  await prisma.answerCacheEntry.deleteMany({
    where: { storeId: input.storeId, knowledgeDocumentId: input.documentId },
  });
  return true;
}

export async function restoreKnowledgeDocument(input: {
  storeId: string;
  documentId: string;
}): Promise<boolean> {
  if (!isObjectId(input.storeId) || !isObjectId(input.documentId)) return false;
  const result = await prisma.knowledgeDocument.updateMany({
    where: { id: input.documentId, storeId: input.storeId },
    // Text is unchanged, so the stored vector is still right; the refresh only embeds if it is missing.
    data: { status: "ready" },
  });
  if (result.count === 0) return false;
  void refreshKnowledgeEmbeddings(input.storeId).catch(() => undefined);
  return true;
}
