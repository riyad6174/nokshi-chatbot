import type { NextRequest } from "next/server";
import { getAdminUser } from "@/lib/auth/admin";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { jsonError } from "@/lib/http";
import { getUploadForSession, getUploadForStore } from "@/modules/conversations/upload.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves a stored attachment to the chat session that uploaded it, or to a signed-in admin.
export async function GET(request: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  const { uploadId } = await params;

  let upload = null;
  const sessionId = readWidgetSessionId(request);
  if (sessionId) upload = await getUploadForSession(uploadId, sessionId);
  if (!upload && (await getAdminUser())) {
    const store = await getPrimaryStore();
    if (store) upload = await getUploadForStore(uploadId, store.id);
  }
  if (!upload) return jsonError(404, "not_found", "File not found.");

  const inline = upload.mime.startsWith("image/") || upload.mime.startsWith("audio/");
  return new Response(new Uint8Array(upload.data), {
    headers: {
      "Content-Type": upload.mime,
      "Content-Length": String(upload.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(upload.name)}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
