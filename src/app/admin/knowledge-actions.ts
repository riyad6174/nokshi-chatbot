"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import { isObjectId } from "@/lib/db/ids";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import { updateUnansweredQuestion, type UnansweredStatus } from "@/modules/knowledge/learning.service";
import {
  archiveKnowledgeDocument,
  publishKnowledgeVersion,
  restoreKnowledgeDocument,
} from "@/modules/knowledge/versions.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

async function adminStore() {
  await requireAdmin();
  const store = await getPrimaryStore();
  if (!store) redirect("/admin?error=store");
  return store;
}

function done(tab: string, saved = "1", error?: string): never {
  revalidatePath("/admin/knowledge");
  const query = new URLSearchParams({ tab, ...(error ? { error } : { saved }) });
  redirect(`/admin/knowledge?${query.toString()}`);
}

function questionStatus(formData: FormData): UnansweredStatus {
  const raw = String(formData.get("status") || "");
  return raw === "reviewing" || raw === "answered" || raw === "ignored" ? raw : "new";
}

async function updateQuestion(formData: FormData, status: UnansweredStatus): Promise<void> {
  const store = await adminStore();
  const id = String(formData.get("questionId") || "");
  if (!isObjectId(id)) done("questions", "1", "Question not found.");
  const resolvedKnowledgeId = String(formData.get("knowledgeId") || "");
  const ok = await updateUnansweredQuestion({
    storeId: store.id,
    id,
    status,
    ...(resolvedKnowledgeId ? { resolvedKnowledgeId } : {}),
  });
  if (!ok) done("questions", "1", "Question not found.");
  logger.info("admin.unanswered_question_updated", { storeId: store.id, questionId: id, status });
  done("questions");
}

/** Knowledge-learning queue and the approved-FAQ answer cache (off by default). */
export async function saveKnowledgeSettingsAction(formData: FormData) {
  const store = await adminStore();
  const tab = String(formData.get("tab") || "published");
  const knowledgeLearningEnabled = formData.get("knowledgeLearningEnabled") === "on";
  const answerCacheEnabled = formData.get("answerCacheEnabled") === "on";
  await prisma.chatbotSettings.update({
    where: { storeId: store.id },
    data: { knowledgeLearningEnabled, answerCacheEnabled },
  });
  // Turning the cache off drops what it held, so turning it back on never serves stale answers.
  if (!answerCacheEnabled) await prisma.answerCacheEntry.deleteMany({ where: { storeId: store.id } });
  logger.info("admin.knowledge_settings_saved", { storeId: store.id, knowledgeLearningEnabled, answerCacheEnabled });
  done(tab);
}

export async function reviewQuestionAction(formData: FormData) {
  await updateQuestion(formData, "reviewing");
}

export async function ignoreQuestionAction(formData: FormData) {
  await updateQuestion(formData, "ignored");
}

export async function resolveQuestionAction(formData: FormData) {
  await updateQuestion(formData, "answered");
}

export async function linkQuestionKnowledgeAction(formData: FormData) {
  await updateQuestion(formData, "answered");
}

export async function publishKnowledgeVersionAction(formData: FormData) {
  const admin = await requireAdmin();
  const store = await getPrimaryStore();
  if (!store) redirect("/admin?error=store");
  const documentId = String(formData.get("documentId") || "");
  const versionId = String(formData.get("versionId") || "");
  const result = await publishKnowledgeVersion({
    storeId: store.id,
    documentId,
    versionId,
    createdBy: admin.email,
  });
  if (!result.ok) {
    revalidatePath(`/admin/knowledge/${documentId}`);
    redirect(`/admin/knowledge/${documentId}?error=${encodeURIComponent(result.error ?? "Could not publish.")}`);
  }
  logger.info("admin.knowledge_version_published", { storeId: store.id, documentId, versionId });
  revalidatePath("/admin/knowledge");
  revalidatePath(`/admin/knowledge/${documentId}`);
  redirect(`/admin/knowledge/${documentId}?saved=published`);
}

export async function archiveKnowledgeAction(formData: FormData) {
  const store = await adminStore();
  const documentId = String(formData.get("documentId") || "");
  const ok = await archiveKnowledgeDocument({ storeId: store.id, documentId });
  if (!ok) redirect("/admin/knowledge?error=Document%20not%20found.");
  revalidatePath("/admin/knowledge");
  revalidatePath(`/admin/knowledge/${documentId}`);
  redirect("/admin/knowledge?tab=archived&saved=1");
}

export async function restoreKnowledgeAction(formData: FormData) {
  const store = await adminStore();
  const documentId = String(formData.get("documentId") || "");
  const ok = await restoreKnowledgeDocument({ storeId: store.id, documentId });
  if (!ok) redirect("/admin/knowledge?error=Document%20not%20found.");
  revalidatePath("/admin/knowledge");
  revalidatePath(`/admin/knowledge/${documentId}`);
  redirect(`/admin/knowledge/${documentId}?saved=restored`);
}

export async function setQuestionStatusAction(formData: FormData) {
  await updateQuestion(formData, questionStatus(formData));
}
