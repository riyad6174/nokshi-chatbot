import type { MessageAttachment } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isObjectId } from "@/lib/db/ids";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// Allowlist. No SVG/HTML: they can carry script when opened directly.
const ALLOWED: Record<string, "image" | "audio" | "file"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "application/pdf": "file",
  "audio/webm": "audio",
  "audio/ogg": "audio",
  "audio/mp4": "audio",
  "audio/mpeg": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
};

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

export function uploadKind(mime: string): "image" | "audio" | "file" | null {
  // Browsers report recordings as e.g. "audio/webm;codecs=opus".
  return ALLOWED[mime.split(";")[0]!.trim().toLowerCase()] ?? null;
}

function cleanName(name: string): string {
  const base = name.replace(/[\\/]/g, "_").replace(/[^\w.\- ()]/g, "").trim();
  return (base || "attachment").slice(0, 120);
}

export async function saveUpload(input: { storeId: string; sessionId: string; file: File }) {
  const kind = uploadKind(input.file.type);
  if (!kind) throw new UploadError("That file type isn't supported. Send an image, PDF, or voice note.");
  if (input.file.size === 0) throw new UploadError("The file is empty.");
  if (input.file.size > MAX_UPLOAD_BYTES) throw new UploadError("Files can be up to 5 MB.");

  const bytes = Buffer.from(await input.file.arrayBuffer());
  const upload = await prisma.upload.create({
    data: {
      storeId: input.storeId,
      sessionId: input.sessionId,
      name: cleanName(input.file.name),
      mime: input.file.type.split(";")[0]!.trim().toLowerCase(),
      size: bytes.length,
      data: bytes,
    },
    select: { id: true, name: true, mime: true, size: true },
  });
  return { ...upload, kind };
}

/**
 * Turns upload ids sent with a message into message attachments. Only uploads made by this session,
 * and not yet attached elsewhere, are accepted.
 */
export async function claimUploads(input: {
  storeId: string;
  sessionId: string;
  conversationId: string;
  items: Array<{ uploadId: string; transcript?: string; durationMs?: number }>;
}): Promise<MessageAttachment[]> {
  const ids = input.items.map((item) => item.uploadId).filter(isObjectId);
  if (ids.length === 0) return [];
  const uploads = await prisma.upload.findMany({
    where: {
      id: { in: ids },
      storeId: input.storeId,
      sessionId: input.sessionId,
      // Not attached yet. In MongoDB `null` only matches an explicit null, so also accept a never-set field.
      OR: [{ conversationId: { isSet: false } }, { conversationId: null }],
    },
    select: { id: true, name: true, mime: true, size: true },
  });
  if (uploads.length === 0) return [];
  await prisma.upload.updateMany({
    where: { id: { in: uploads.map((upload) => upload.id) } },
    data: { conversationId: input.conversationId },
  });
  return uploads.map((upload) => {
    const item = input.items.find((entry) => entry.uploadId === upload.id);
    const kind = uploadKind(upload.mime) ?? "file";
    return {
      uploadId: upload.id,
      name: upload.name,
      mime: upload.mime,
      size: upload.size,
      kind,
      transcript: kind === "audio" ? item?.transcript?.trim().slice(0, 2000) || null : null,
      durationMs: kind === "audio" && item?.durationMs ? Math.min(Math.round(item.durationMs), 10 * 60_000) : null,
    };
  });
}

export async function getUploadForSession(uploadId: string, sessionId: string) {
  if (!isObjectId(uploadId)) return null;
  return prisma.upload.findFirst({ where: { id: uploadId, sessionId } });
}

export async function getUploadForStore(uploadId: string, storeId: string) {
  if (!isObjectId(uploadId)) return null;
  return prisma.upload.findFirst({ where: { id: uploadId, storeId } });
}
