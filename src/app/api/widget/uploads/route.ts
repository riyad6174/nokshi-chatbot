import type { NextRequest } from "next/server";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { jsonError, jsonOk } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSessionContext } from "@/modules/conversations/session.service";
import { MAX_UPLOAD_BYTES, UploadError, saveUpload } from "@/modules/conversations/upload.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session first.");

  const rate = checkRateLimit(`upload:${sessionId}`, 20, 10 * 60_000);
  if (!rate.allowed) return jsonError(429, "rate_limited", "Too many uploads. Please wait a few minutes.");

  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired.");
  if (context.store.settings?.attachmentsEnabled === false && context.store.settings?.voiceEnabled === false) {
    return jsonError(403, "uploads_disabled", "Attachments are turned off for this store.");
  }

  // Reject oversized bodies before buffering them.
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) return jsonError(413, "too_large", "Files can be up to 5 MB.");

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError(400, "file_required", "Attach a file.");

  try {
    const upload = await saveUpload({ storeId: context.storeId, sessionId: context.sessionId, file });
    return jsonOk({ upload: { uploadId: upload.id, name: upload.name, mime: upload.mime, size: upload.size, kind: upload.kind } });
  } catch (error) {
    if (error instanceof UploadError) return jsonError(400, "invalid_file", error.message);
    throw error;
  }
}
