import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/db/prisma";
import { isSyncDue, syncProductSource } from "@/modules/catalog/product-sync.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// For a scheduler (e.g. Vercel Cron): GET /api/cron/product-sync with "Authorization: Bearer $CRON_SECRET".
// Runs every store whose API product source is due.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const ok =
    secret.length >= 16 &&
    provided.length === secret.length &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  if (!ok) return jsonError(401, "unauthorized", "Missing or invalid cron secret.");

  const sources = await prisma.productSource.findMany({ where: { mode: "api", autoSync: true } });
  const results: Array<{ storeId: string; ok: boolean; error?: string }> = [];
  for (const source of sources) {
    if (!isSyncDue(source)) continue;
    try {
      await syncProductSource(source.storeId);
      results.push({ storeId: source.storeId, ok: true });
    } catch (error) {
      results.push({ storeId: source.storeId, ok: false, error: error instanceof Error ? error.message : "failed" });
    }
  }
  return jsonOk({ ran: results.length, results });
}
