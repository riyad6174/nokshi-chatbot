import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { flagAbandonedCarts } from "@/modules/customers/events.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// For a scheduler (e.g. Vercel Cron, hourly): GET /api/cron/abandoned-carts with "Authorization: Bearer $CRON_SECRET".
// Records an abandoned_cart event for carts idle for 2 hours, for follow-up marketing.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const ok =
    secret.length >= 16 &&
    provided.length === secret.length &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  if (!ok) return jsonError(401, "unauthorized", "Missing or invalid cron secret.");

  const flagged = await flagAbandonedCarts();
  return jsonOk({ flagged });
}
