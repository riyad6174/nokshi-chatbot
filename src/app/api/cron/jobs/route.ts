import type { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { prisma } from "@/lib/db/prisma";
import { enqueueJob, runDueJobs } from "@/modules/jobs/job.service";
import { embeddingsConfig } from "@/modules/search/embeddings.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// For a scheduler (every minute): GET /api/cron/jobs with "Authorization: Bearer $CRON_SECRET".
// Runs due background jobs (cart reminders, campaign sends, embedding refreshes). Safe to call from
// several schedulers or instances at once: each job is claimed atomically.
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) return jsonError(401, "unauthorized", "Missing or invalid cron secret.");

  // Semantic search on: refresh changed product/knowledge vectors at most every 10 minutes per store.
  if (embeddingsConfig()) {
    const window = Math.floor(Date.now() / 600_000);
    const stores = await prisma.store.findMany({ select: { id: true } });
    for (const store of stores) {
      await enqueueJob({ type: "embeddings.refresh", storeId: store.id, payload: { storeId: store.id }, dedupeKey: `${store.id}:${window}`, maxAttempts: 2 });
    }
  }

  const counts = await runDueJobs({ limit: 200, budgetMs: 240_000 });
  return jsonOk(counts);
}
