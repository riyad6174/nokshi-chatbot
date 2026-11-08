import { randomUUID } from "node:crypto";
import type { Job } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";

// A small durable job queue on MongoDB, so scheduled work (cart reminders, campaigns, embeddings)
// survives restarts and runs exactly once even with several app instances:
// - enqueue is idempotent per (type, dedupeKey);
// - a worker claims a job with a conditional update (status + lock), so two workers never run it twice;
// - failures retry with exponential backoff up to maxAttempts, then stay "failed" for inspection;
// - a job whose worker died is picked up again once its lock expires.
// Workers run from GET /api/cron/jobs (call it every minute) and opportunistically elsewhere.

export type JobHandler = (job: Job, payload: Record<string, unknown>) => Promise<void>;

/** Thrown by a handler to stop retrying (bad payload, permanent condition). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

const handlers = new Map<string, JobHandler>();
const WORKER_ID = randomUUID().slice(0, 8);
const LOCK_MS = 5 * 60_000;

export function registerJobHandler(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export async function enqueueJob(input: {
  type: string;
  storeId?: string | null;
  payload?: Record<string, unknown>;
  runAt?: Date;
  dedupeKey?: string;
  maxAttempts?: number;
}): Promise<{ id: string; created: boolean }> {
  const dedupeKey = input.dedupeKey ?? randomUUID();
  const existing = await prisma.job.findUnique({ where: { type_dedupeKey: { type: input.type, dedupeKey } }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };
  try {
    const job = await prisma.job.create({
      data: {
        type: input.type,
        storeId: input.storeId ?? null,
        payload: JSON.stringify(input.payload ?? {}),
        runAt: input.runAt ?? new Date(),
        dedupeKey,
        maxAttempts: input.maxAttempts ?? 5,
      },
      select: { id: true },
    });
    return { id: job.id, created: true };
  } catch (error) {
    // Two instances enqueued the same job at once: the unique index kept one.
    if ((error as { code?: string }).code === "P2002") {
      const job = await prisma.job.findUnique({ where: { type_dedupeKey: { type: input.type, dedupeKey } }, select: { id: true } });
      if (job) return { id: job.id, created: false };
    }
    throw error;
  }
}

/** Claims one due job for this worker, or null. */
export async function claimNextJob(now = new Date(), types?: string[]): Promise<Job | null> {
  // A few candidates, since another worker may win the race for the first.
  const candidates = await prisma.job.findMany({
    where: {
      runAt: { lte: now },
      ...(types ? { type: { in: types } } : {}),
      OR: [{ status: "queued" }, { status: "running", lockedUntil: { lt: now } }],
    },
    orderBy: { runAt: "asc" },
    take: 5,
    select: { id: true, status: true, lockedUntil: true },
  });
  for (const candidate of candidates) {
    const claimed = await prisma.job.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        ...(candidate.status === "running" ? { lockedUntil: candidate.lockedUntil } : {}),
      },
      data: {
        status: "running",
        lockedUntil: new Date(now.getTime() + LOCK_MS),
        lockedBy: WORKER_ID,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 1) return prisma.job.findUnique({ where: { id: candidate.id } });
  }
  return null;
}

function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60_000);
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function runJob(job: Job): Promise<"done" | "retry" | "failed"> {
  const handler = handlers.get(job.type);
  if (!handler) {
    await prisma.job.update({ where: { id: job.id }, data: { status: "failed", lastError: "No handler for this job type.", lockedUntil: null } });
    logger.error("job.no_handler", { type: job.type, jobId: job.id });
    return "failed";
  }
  try {
    await handler(job, parsePayload(job.payload));
    await prisma.job.update({ where: { id: job.id }, data: { status: "done", completedAt: new Date(), lockedUntil: null, lastError: "" } });
    return "done";
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const permanent = error instanceof PermanentJobError;
    const exhausted = job.attempts >= job.maxAttempts;
    if (permanent || exhausted) {
      await prisma.job.update({ where: { id: job.id }, data: { status: "failed", lastError: message, lockedUntil: null } });
      logger.error("job.failed", { type: job.type, jobId: job.id, attempts: job.attempts, error: message });
      return "failed";
    }
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "queued", lastError: message, lockedUntil: null, runAt: new Date(Date.now() + backoffMs(job.attempts)) },
    });
    logger.warn("job.retry", { type: job.type, jobId: job.id, attempts: job.attempts, error: message });
    return "retry";
  }
}

/** Runs due jobs until none are left, `limit` is reached, or `budgetMs` has passed. */
export async function runDueJobs(options: { limit?: number; budgetMs?: number; types?: string[] } = {}) {
  const { ensureJobHandlers } = await import("@/modules/jobs/handlers");
  ensureJobHandlers();
  const limit = options.limit ?? 50;
  const deadline = Date.now() + (options.budgetMs ?? 50_000);
  const counts = { done: 0, retry: 0, failed: 0 };
  for (let index = 0; index < limit && Date.now() < deadline; index += 1) {
    const job = await claimNextJob(new Date(), options.types);
    if (!job) break;
    counts[await runJob(job)] += 1;
  }
  return counts;
}

export async function jobQueueHealth() {
  const now = new Date();
  const [queued, overdue, failed] = await Promise.all([
    prisma.job.count({ where: { status: "queued" } }),
    prisma.job.count({ where: { status: "queued", runAt: { lt: new Date(now.getTime() - 15 * 60_000) } } }),
    prisma.job.count({ where: { status: "failed", updatedAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) } } }),
  ]);
  return { queued, overdue, failedLast24h: failed };
}
