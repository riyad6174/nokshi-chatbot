import { logger } from "@/lib/logging/logger";

// Fixed-window rate limiting with two backends:
// - "memory": per process. Fine for one instance, development and tests.
// - "mongo": shared by every instance through an atomic counter document per key and window in the
//   `rate_limit_buckets` collection (expired windows are removed by a TTL index). Use this when the
//   app runs on several instances or serverless functions, where in-memory counters don't add up.
// RATE_LIMIT_BACKEND selects it; production defaults to "mongo". A database error falls back to the
// in-memory counter (fail open, logged) so a brief database hiccup never blocks customers outright.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

function result(count: number, limit: number, resetAt: number, now: number): RateLimitResult {
  const allowed = count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - count),
    resetAt,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}

/** In-memory (per instance) limiter. Kept synchronous for callers that can't await. */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return result(1, limit, resetAt, now);
  }
  existing.count += 1;
  return result(existing.count, limit, existing.resetAt, now);
}

export type RateLimitBackend = "memory" | "mongo";

export function rateLimitBackend(): RateLimitBackend {
  const configured = (process.env.RATE_LIMIT_BACKEND ?? "").trim().toLowerCase();
  if (configured === "memory" || configured === "mongo") return configured;
  return process.env.NODE_ENV === "production" ? "mongo" : "memory";
}

const COLLECTION = "rate_limit_buckets";
let ttlIndexReady: Promise<void> | null = null;

function ensureTtlIndex(): Promise<void> {
  ttlIndexReady ??= (async () => {
    const { prisma } = await import("@/lib/db/prisma");
    await prisma.$runCommandRaw({
      createIndexes: COLLECTION,
      indexes: [{ key: { expiresAt: 1 }, name: "expiresAt_ttl", expireAfterSeconds: 0 }],
    });
  })().catch((error) => {
    ttlIndexReady = null;
    logger.warn("rate_limit.ttl_index_failed", { error: error instanceof Error ? error.message : String(error) });
  });
  return ttlIndexReady;
}

async function mongoIncrement(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }> {
  const { prisma } = await import("@/lib/db/prisma");
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;
  void ensureTtlIndex();
  // findAndModify with upsert is atomic on the server, so concurrent instances never lose a count.
  const response = (await prisma.$runCommandRaw({
    findAndModify: COLLECTION,
    query: { _id: `${key}|${windowStart}` },
    update: { $inc: { count: 1 }, $setOnInsert: { expiresAt: { $date: new Date(resetAt + 60_000).toISOString() } } },
    upsert: true,
    new: true,
  })) as { value?: { count?: number } };
  return { count: Number(response.value?.count ?? 1), resetAt };
}

/**
 * Shared rate limit for API routes. `key` should name the action and the caller,
 * e.g. `message:session:<id>`.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  if (rateLimitBackend() === "memory") return checkRateLimit(key, limit, windowMs);
  const now = Date.now();
  try {
    const { count, resetAt } = await mongoIncrement(key, windowMs, now);
    return result(count, limit, resetAt, now);
  } catch (error) {
    logger.warn("rate_limit.backend_failed", { error: error instanceof Error ? error.message : String(error) });
    return checkRateLimit(key, limit, windowMs);
  }
}

/** Test hook: the Mongo backend regardless of the environment. */
export async function rateLimitMongoForTest(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const now = Date.now();
  const { count, resetAt } = await mongoIncrement(key, windowMs, now);
  return result(count, limit, resetAt, now);
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") || "unknown";
}
