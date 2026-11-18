import type { PromptVersion } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";

// Store-specific prompt overrides (the owner's "business instructions") are versioned here. Core
// safety and business rules stay in code (system-instructions.ts) and are never stored or editable.
// The live text still lives on ChatbotSettings.systemInstructions so the hot path reads one row;
// each change is recorded as a new published version, and older ones can be restored.

export const OWNER_INSTRUCTIONS_KEY = "system_instructions";

/**
 * Records `content` as the newest published version when it differs from the current one.
 * Returns the new version, or null when nothing changed. Never throws: versioning must not block
 * saving settings.
 */
export async function recordPromptVersion(input: {
  storeId: string;
  content: string;
  createdBy?: string;
  key?: string;
}): Promise<PromptVersion | null> {
  const key = input.key ?? OWNER_INSTRUCTIONS_KEY;
  const content = input.content.trim();
  try {
    const latest = await prisma.promptVersion.findFirst({
      where: { storeId: input.storeId, key },
      orderBy: { version: "desc" },
    });
    if (latest && latest.status === "published" && latest.content === content) return null;
    // Nothing recorded yet and nothing set: no point in a version 1 that says "empty".
    if (!latest && !content) return null;

    const now = new Date();
    const [, created] = await prisma.$transaction([
      prisma.promptVersion.updateMany({
        where: { storeId: input.storeId, key, status: "published" },
        data: { status: "archived" },
      }),
      prisma.promptVersion.create({
        data: {
          storeId: input.storeId,
          key,
          version: (latest?.version ?? 0) + 1,
          content,
          status: "published",
          createdBy: (input.createdBy ?? "").slice(0, 120),
          publishedAt: now,
        },
      }),
    ]);
    return created;
  } catch (error) {
    logger.warn("prompt_version.record_failed", {
      storeId: input.storeId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function listPromptVersions(storeId: string, key = OWNER_INSTRUCTIONS_KEY, take = 20) {
  return prisma.promptVersion.findMany({
    where: { storeId, key },
    orderBy: { version: "desc" },
    take,
  });
}

/**
 * Makes an older version live again: copies its text to the settings and records it as a new
 * version (history is append-only, so the restore itself is visible in the list).
 */
export async function restorePromptVersion(input: {
  storeId: string;
  versionId: string;
  createdBy?: string;
}): Promise<PromptVersion | null> {
  const source = await prisma.promptVersion.findFirst({
    where: { id: input.versionId, storeId: input.storeId },
  });
  if (!source) return null;
  if (source.key === OWNER_INSTRUCTIONS_KEY) {
    await prisma.chatbotSettings.update({
      where: { storeId: input.storeId },
      data: { systemInstructions: source.content },
    });
  }
  return recordPromptVersion({
    storeId: input.storeId,
    key: source.key,
    content: source.content,
    createdBy: input.createdBy ?? `restored v${source.version}`,
  });
}
