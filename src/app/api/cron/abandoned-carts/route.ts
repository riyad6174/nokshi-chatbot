import type { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { flagAbandonedCarts } from "@/modules/customers/events.service";
import { scheduleAbandonedCartReminders } from "@/modules/marketing/campaign.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// For a scheduler (e.g. Vercel Cron, hourly): GET /api/cron/abandoned-carts with "Authorization: Bearer $CRON_SECRET".
// Records an abandoned_cart event for carts idle for 2 hours, then queues a reminder for each one
// whose store runs an active abandoned-cart campaign (sent by /api/cron/jobs, only with consent).
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) return jsonError(401, "unauthorized", "Missing or invalid cron secret.");

  const flagged = await flagAbandonedCarts();
  const reminders = await scheduleAbandonedCartReminders();
  return jsonOk({ flagged, remindersQueued: reminders });
}
