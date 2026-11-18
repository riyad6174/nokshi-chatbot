import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import type { NormalizedUsage } from "@/modules/ai/usage";

/**
 * Admin-managed model pricing. There are deliberately no built-in rates: a provider model without
 * a matching row is reported as unpriced instead of being given an invented cost.
 *
 * Rates are USD per one million tokens. One token at one dollar per million therefore equals one
 * USD micro, which lets costs be stored as precise integers.
 */
export type PricingRow = {
  id: string;
  providerId: string;
  model: string;
  inputPerMillion: number;
  cachedInputPerMillion: number;
  cacheWritePerMillion: number;
  outputPerMillion: number;
  /** Audio rates (Realtime). Null: audio tokens use the text rates above. */
  audioInputPerMillion: number | null;
  cachedAudioInputPerMillion: number | null;
  audioOutputPerMillion: number | null;
  active: boolean;
  note: string;
  updatedAt: Date;
};

export type UsageCost = {
  costMicros: number | null;
  pricingStatus: "priced" | "unpriced";
  pricingVersion: string;
};

const CACHE_TTL_MS = 30_000;
const pricingCache = new Map<string, { at: number; rows: PricingRow[] }>();

function normalizeRate(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function optionalRate(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function toPricingRow(row: {
  id: string;
  providerId: string;
  model: string;
  inputPerMillion: number;
  cachedInputPerMillion: number;
  cacheWritePerMillion: number;
  outputPerMillion: number;
  audioInputPerMillion?: number | null;
  cachedAudioInputPerMillion?: number | null;
  audioOutputPerMillion?: number | null;
  active: boolean;
  note: string;
  updatedAt: Date;
}): PricingRow {
  return {
    id: row.id,
    providerId: row.providerId,
    model: row.model,
    inputPerMillion: normalizeRate(row.inputPerMillion),
    cachedInputPerMillion: normalizeRate(row.cachedInputPerMillion),
    cacheWritePerMillion: normalizeRate(row.cacheWritePerMillion),
    outputPerMillion: normalizeRate(row.outputPerMillion),
    audioInputPerMillion: optionalRate(row.audioInputPerMillion),
    cachedAudioInputPerMillion: optionalRate(row.cachedAudioInputPerMillion),
    audioOutputPerMillion: optionalRate(row.audioOutputPerMillion),
    active: row.active,
    note: row.note,
    updatedAt: row.updatedAt,
  };
}

async function rowsForProvider(providerId: string): Promise<PricingRow[]> {
  const cacheKey = providerId || "*";
  const cached = pricingCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;

  try {
    const rows = await prisma.modelPricing.findMany({
      where: {
        ...(providerId ? { providerId } : {}),
        active: true,
        effectiveFrom: { lte: new Date() },
      },
      orderBy: { updatedAt: "desc" },
    });
    const normalized = rows.map(toPricingRow);
    pricingCache.set(cacheKey, { at: Date.now(), rows: normalized });
    return normalized;
  } catch (error) {
    logger.warn("pricing.lookup_failed", { providerId, error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Exact model first, then the longest matching prefix. A `*` model acts as a provider fallback.
 * This handles providers that append date or deployment suffixes to model names.
 */
export async function resolveModelPricing(providerId: string, model: string): Promise<PricingRow | null> {
  const requested = model.trim();
  if (!requested) return null;
  const rows = await rowsForProvider(providerId.trim());
  const exact = rows.find((row) => row.model === requested);
  if (exact) return exact;

  const prefixed = rows
    .filter((row) => row.model !== "*" && requested.startsWith(row.model))
    .sort((left, right) => right.model.length - left.model.length)[0];
  if (prefixed) return prefixed;

  return rows.find((row) => row.model === "*") ?? null;
}

export function computeCostMicros(usage: NormalizedUsage, pricing: PricingRow): number {
  // Rate is USD per 1M tokens, so tokens * rate is already USD micros. Audio tokens (a subset of
  // each total) use the audio rate when one is set, otherwise the text rate like the rest.
  const split = (total: number, audio: number, textRate: number, audioRate: number | null | undefined) =>
    (total - audio) * normalizeRate(textRate) + audio * normalizeRate(audioRate ?? textRate);
  const input = split(usage.inputTokens, usage.audioInputTokens ?? 0, pricing.inputPerMillion, pricing.audioInputPerMillion);
  const cached = split(
    usage.cachedInputTokens,
    usage.cachedAudioInputTokens ?? 0,
    pricing.cachedInputPerMillion,
    pricing.cachedAudioInputPerMillion,
  );
  const cacheWrite = usage.cacheWriteInputTokens * normalizeRate(pricing.cacheWritePerMillion);
  const output = split(usage.outputTokens, usage.audioOutputTokens ?? 0, pricing.outputPerMillion, pricing.audioOutputPerMillion);
  return Math.round(input + cached + cacheWrite + output);
}

export async function resolveUsageCost(input: {
  providerId: string;
  model: string;
  usage: NormalizedUsage;
}): Promise<UsageCost> {
  const pricing = await resolveModelPricing(input.providerId, input.model);
  if (!pricing) {
    return { costMicros: null, pricingStatus: "unpriced", pricingVersion: "" };
  }
  return {
    costMicros: computeCostMicros(input.usage, pricing),
    pricingStatus: "priced",
    pricingVersion: pricing.id,
  };
}

export function invalidatePricingCache(): void {
  pricingCache.clear();
}

export async function listModelPricing(): Promise<PricingRow[]> {
  const rows = await prisma.modelPricing.findMany({ orderBy: [{ providerId: "asc" }, { model: "asc" }] });
  return rows.map(toPricingRow);
}

export async function getModelPricing(id: string): Promise<PricingRow | null> {
  const row = await prisma.modelPricing.findUnique({ where: { id } });
  return row ? toPricingRow(row) : null;
}

export type UpsertPricingInput = {
  providerId: string;
  model: string;
  inputPerMillion: number;
  cachedInputPerMillion: number;
  cacheWritePerMillion: number;
  outputPerMillion: number;
  audioInputPerMillion?: number | null;
  cachedAudioInputPerMillion?: number | null;
  audioOutputPerMillion?: number | null;
  active: boolean;
  note: string;
};

export async function upsertModelPricing(input: UpsertPricingInput): Promise<PricingRow> {
  const providerId = input.providerId.trim();
  const model = input.model.trim();
  const audio = {
    audioInputPerMillion: input.audioInputPerMillion ?? null,
    cachedAudioInputPerMillion: input.cachedAudioInputPerMillion ?? null,
    audioOutputPerMillion: input.audioOutputPerMillion ?? null,
  };
  const row = await prisma.modelPricing.upsert({
    where: { providerId_model: { providerId, model } },
    create: {
      providerId,
      model,
      currency: "USD",
      inputPerMillion: input.inputPerMillion,
      cachedInputPerMillion: input.cachedInputPerMillion,
      cacheWritePerMillion: input.cacheWritePerMillion,
      outputPerMillion: input.outputPerMillion,
      ...audio,
      active: input.active,
      note: input.note,
      effectiveFrom: new Date(),
    },
    update: {
      currency: "USD",
      inputPerMillion: input.inputPerMillion,
      cachedInputPerMillion: input.cachedInputPerMillion,
      cacheWritePerMillion: input.cacheWritePerMillion,
      outputPerMillion: input.outputPerMillion,
      ...audio,
      active: input.active,
      note: input.note,
      effectiveFrom: new Date(),
    },
  });
  invalidatePricingCache();
  return toPricingRow(row);
}
