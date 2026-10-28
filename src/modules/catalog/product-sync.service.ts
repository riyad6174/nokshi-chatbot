import type { ProductSource } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import { parseJsonObject } from "@/modules/stores/store.service";

// "Auto entry": a public product API is the source of truth for the catalog. Each sync upserts into
// the same Product collection the storefront and the assistant use (matched by externalProductId),
// so products are never stored in two places.

export type FieldMapping = {
  itemsPath: string;
  id: string;
  name: string;
  price: string;
  description: string;
  image: string;
  category: string;
  brand: string;
  stock: string;
  currency: string;
};

export const MAPPING_FIELDS: Array<{ key: keyof FieldMapping; label: string; required?: boolean }> = [
  { key: "itemsPath", label: "Items path (where the product array is)" },
  { key: "id", label: "ID", required: true },
  { key: "name", label: "Name", required: true },
  { key: "price", label: "Price", required: true },
  { key: "description", label: "Description" },
  { key: "image", label: "Image URL" },
  { key: "category", label: "Category" },
  { key: "brand", label: "Brand" },
  { key: "stock", label: "Stock quantity" },
  { key: "currency", label: "Currency" },
];

const CANDIDATES: Record<Exclude<keyof FieldMapping, "itemsPath">, string[]> = {
  id: ["id", "_id", "sku", "productId", "product_id", "code"],
  name: ["name", "title", "productName", "product_name"],
  price: ["price", "salePrice", "sale_price", "amount", "regularPrice", "price.amount"],
  description: ["description", "summary", "details", "body", "short_description"],
  image: ["image", "imageUrl", "image_url", "thumbnail", "images.0", "images.0.src", "photo", "picture"],
  category: ["category", "category.name", "categoryName", "type", "productType"],
  brand: ["brand", "brand.name", "vendor", "manufacturer"],
  stock: ["stock", "quantity", "inventory", "stockQuantity", "stock_quantity", "available_quantity"],
  currency: ["currency", "price.currency", "currencyCode"],
};

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_PRODUCTS = 2000;
const LOCK_MS = 5 * 60_000;

export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncError";
  }
}

/** Reads "data.products", "images.0.src", etc. */
export function getByPath(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split(".").reduce<unknown>((current, key) => {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(key)) return current[Number(key)];
    if (typeof current === "object") return (current as Record<string, unknown>)[key];
    return undefined;
  }, value);
}

function findItemsPath(payload: unknown): string | null {
  if (Array.isArray(payload)) return "";
  if (!payload || typeof payload !== "object") return null;
  // Breadth-first search (depth 3) for the largest array of objects.
  let best: { path: string; size: number } | null = null;
  const queue: Array<{ value: unknown; path: string; depth: number }> = [{ value: payload, path: "", depth: 0 }];
  while (queue.length > 0) {
    const { value, path, depth } = queue.shift()!;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (Array.isArray(child) && child.length > 0 && typeof child[0] === "object") {
        if (!best || child.length > best.size) best = { path: childPath, size: child.length };
      } else if (depth < 3) {
        queue.push({ value: child, path: childPath, depth: depth + 1 });
      }
    }
  }
  return best?.path ?? null;
}

/** Guesses a mapping from the first item; explicit values in `partial` win. */
export function detectMapping(payload: unknown, partial: Partial<FieldMapping> = {}): FieldMapping {
  const itemsPath = partial.itemsPath ?? findItemsPath(payload) ?? "";
  const items = getByPath(payload, itemsPath);
  const sample = Array.isArray(items) ? items[0] : undefined;
  const guess = (key: Exclude<keyof FieldMapping, "itemsPath">) => {
    if (partial[key]) return partial[key]!;
    return CANDIDATES[key].find((candidate) => {
      const found = getByPath(sample, candidate);
      return found !== undefined && found !== null && found !== "" && typeof found !== "object";
    }) ?? "";
  };
  return {
    itemsPath,
    id: guess("id"),
    name: guess("name"),
    price: guess("price"),
    description: guess("description"),
    image: guess("image"),
    category: guess("category"),
    brand: guess("brand"),
    stock: guess("stock"),
    currency: guess("currency"),
  };
}

export function parseMapping(value: string | null | undefined): Partial<FieldMapping> {
  const raw = parseJsonObject(value);
  return Object.fromEntries(
    Object.entries(raw).filter(([, entry]) => typeof entry === "string") as Array<[string, string]>,
  ) as Partial<FieldMapping>;
}

export type NormalizedProduct = {
  externalId: string;
  name: string;
  description: string;
  priceMinor: number;
  currency: string | null;
  imageUrl: string | null;
  category: string;
  brand: string;
  stock: number | null;
};

function toText(value: unknown, max: number): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeItems(
  payload: unknown,
  mapping: FieldMapping,
  priceUnit: "major" | "minor",
): { products: NormalizedProduct[]; skipped: Array<{ index: number; reason: string }>; total: number } {
  const items = getByPath(payload, mapping.itemsPath);
  if (!Array.isArray(items)) throw new SyncError(`No product list found at "${mapping.itemsPath || "(root)"}".`);

  const products: NormalizedProduct[] = [];
  const skipped: Array<{ index: number; reason: string }> = [];
  const seen = new Set<string>();

  items.slice(0, MAX_PRODUCTS).forEach((item, index) => {
    const externalId = toText(getByPath(item, mapping.id), 120);
    const name = toText(getByPath(item, mapping.name), 200);
    const price = toNumber(getByPath(item, mapping.price));
    if (!externalId) return skipped.push({ index, reason: "missing id" });
    if (seen.has(externalId)) return skipped.push({ index, reason: "duplicate id" });
    if (!name) return skipped.push({ index, reason: "missing name" });
    if (price === null || price < 0) return skipped.push({ index, reason: "missing or invalid price" });
    seen.add(externalId);

    const image = mapping.image ? toText(getByPath(item, mapping.image), 500) : "";
    const stock = mapping.stock ? toNumber(getByPath(item, mapping.stock)) : null;
    products.push({
      externalId,
      name,
      description: mapping.description ? toText(getByPath(item, mapping.description), 4000) : "",
      priceMinor: priceUnit === "minor" ? Math.round(price) : Math.round(price * 100),
      currency: mapping.currency ? toText(getByPath(item, mapping.currency), 3).toUpperCase() || null : null,
      imageUrl: /^https?:\/\//i.test(image) ? image : null,
      category: (mapping.category ? toText(getByPath(item, mapping.category), 80) : "") || "General",
      brand: mapping.brand ? toText(getByPath(item, mapping.brand), 80) : "",
      stock: stock === null ? null : Math.max(0, Math.floor(stock)),
    });
  });
  return { products, skipped, total: items.length };
}

/** Server-side fetch of an admin-provided URL: web URLs only, no cloud metadata endpoints, size-capped. */
export async function fetchSourceJson(url: string): Promise<unknown> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SyncError("Enter a valid URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new SyncError("The API URL must start with http:// or https://.");
  if (["169.254.169.254", "metadata.google.internal", "[fd00:ec2::254]"].includes(parsed.hostname)) {
    throw new SyncError("That address isn't allowed.");
  }

  let response: Response;
  try {
    response = await fetch(parsed, {
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new SyncError("Couldn't reach the API (network error or timeout after 15 seconds).");
  }
  if (!response.ok) throw new SyncError(`The API responded with HTTP ${response.status}.`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_RESPONSE_BYTES) throw new SyncError("The API response is larger than 5 MB.");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new SyncError("The API response is larger than 5 MB.");
  try {
    return JSON.parse(text);
  } catch {
    throw new SyncError("The API didn't return JSON.");
  }
}

export async function previewSource(input: { url: string; mapping: Partial<FieldMapping>; priceUnit: "major" | "minor" }) {
  const payload = await fetchSourceJson(input.url);
  const mapping = detectMapping(payload, input.mapping);
  const missing = MAPPING_FIELDS.filter((field) => field.required && !mapping[field.key]).map((field) => field.label);
  if (missing.length > 0) {
    return { mapping, products: [], skipped: [], total: 0, error: `Couldn't find: ${missing.join(", ")}. Set these fields manually.` };
  }
  const result = normalizeItems(payload, mapping, input.priceUnit);
  return { mapping, ...result, products: result.products.slice(0, 12), count: result.products.length, error: null };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "product";
}

export type SyncCounts = { created: number; updated: number; deactivated: number; skipped: number; total: number };

/** Runs a full sync. Safe to call concurrently: a lock document keeps only one sync running per store. */
export async function syncProductSource(storeId: string): Promise<SyncCounts> {
  const now = new Date();
  // Take the lock atomically.
  const locked = await prisma.productSource.updateMany({
    where: {
      storeId,
      mode: "api",
      // In MongoDB `null` only matches an explicit null, so also accept a never-set field.
      OR: [{ syncLockedUntil: { isSet: false } }, { syncLockedUntil: null }, { syncLockedUntil: { lt: now } }],
    },
    data: { syncLockedUntil: new Date(now.getTime() + LOCK_MS), lastStatus: "running" },
  });
  if (locked.count === 0) throw new SyncError("A sync is already running, or the product source isn't set to API.");

  const source = await prisma.productSource.findUniqueOrThrow({ where: { storeId }, include: { store: true } });
  try {
    const payload = await fetchSourceJson(source.apiUrl);
    const mapping = detectMapping(payload, parseMapping(source.mapping));
    if (!mapping.id || !mapping.name || !mapping.price) throw new SyncError("The field mapping needs ID, Name and Price.");
    const { products, skipped, total } = normalizeItems(payload, mapping, source.priceUnit === "minor" ? "minor" : "major");

    const existing = await prisma.product.findMany({
      where: { storeId, sourceType: "api" },
      select: { id: true, externalProductId: true, slug: true, status: true },
    });
    const byExternal = new Map(existing.map((product) => [product.externalProductId, product]));
    const usedSlugs = new Set(
      (await prisma.product.findMany({ where: { storeId }, select: { slug: true } })).map((product) => product.slug),
    );

    let created = 0;
    let updated = 0;
    for (const item of products) {
      const data = {
        name: item.name,
        description: item.description,
        category: item.category,
        brand: item.brand,
        imageUrl: item.imageUrl,
        priceMinor: item.priceMinor,
        currency: item.currency ?? source.store.currency,
        status: "active",
      };
      const match = byExternal.get(item.externalId);
      let productId: string;
      if (match) {
        await prisma.product.update({ where: { id: match.id }, data });
        productId = match.id;
        updated += 1;
      } else {
        let slug = slugify(item.name);
        if (usedSlugs.has(slug)) slug = `${slug}-${slugify(item.externalId)}`.slice(0, 110);
        usedSlugs.add(slug);
        const product = await prisma.product.create({
          data: { ...data, storeId, slug, sourceType: "api", externalProductId: item.externalId },
        });
        productId = product.id;
        created += 1;
      }
      // One default variant carries stock for API products.
      await prisma.productVariant.upsert({
        where: { productId_sku: { productId, sku: `api-${item.externalId}`.slice(0, 80) } },
        update: {
          stockQuantity: item.stock,
          stockStatus: item.stock === 0 ? "out_of_stock" : "in_stock",
        },
        create: {
          productId,
          storeId,
          sku: `api-${item.externalId}`.slice(0, 80),
          title: "Standard",
          externalVariantId: item.externalId,
          stockQuantity: item.stock,
          stockStatus: item.stock === 0 ? "out_of_stock" : "in_stock",
        },
      });
    }

    // Products that disappeared from the feed: hide them, don't delete (orders reference them).
    const feedIds = new Set(products.map((item) => item.externalId));
    const gone = existing.filter((product) => product.status === "active" && !feedIds.has(product.externalProductId ?? ""));
    if (gone.length > 0) {
      await prisma.product.updateMany({ where: { id: { in: gone.map((product) => product.id) } }, data: { status: "inactive" } });
    }

    const counts: SyncCounts = { created, updated, deactivated: gone.length, skipped: skipped.length, total };
    await prisma.productSource.update({
      where: { storeId },
      data: {
        mapping: JSON.stringify(mapping),
        lastSyncAt: new Date(),
        lastStatus: "ok",
        lastError: "",
        lastCounts: JSON.stringify(counts),
        syncLockedUntil: null,
      },
    });
    logger.info("catalog.sync_completed", { storeId, ...counts });
    return counts;
  } catch (error) {
    const message = error instanceof SyncError ? error.message : "The sync failed unexpectedly.";
    await prisma.productSource.update({
      where: { storeId },
      data: { lastStatus: "error", lastError: message, lastSyncAt: new Date(), syncLockedUntil: null },
    });
    logger.error("catalog.sync_failed", { storeId, error: error instanceof Error ? error.message : String(error) });
    throw error instanceof SyncError ? error : new SyncError(message);
  }
}

export function isSyncDue(source: Pick<ProductSource, "mode" | "autoSync" | "intervalMinutes" | "lastSyncAt" | "syncLockedUntil">) {
  if (source.mode !== "api" || !source.autoSync) return false;
  if (source.syncLockedUntil && source.syncLockedUntil > new Date()) return false;
  if (!source.lastSyncAt) return true;
  return Date.now() - source.lastSyncAt.getTime() >= Math.max(5, source.intervalMinutes) * 60_000;
}

/**
 * Opportunistic auto-sync, triggered by traffic (chat sessions, dashboard visits). Doesn't block the caller.
 * For exact schedules in production, call /api/cron/product-sync from a scheduler.
 */
export function triggerAutoSyncIfDue(storeId: string) {
  void (async () => {
    const source = await prisma.productSource.findUnique({ where: { storeId } });
    if (!source || !isSyncDue(source)) return;
    await syncProductSource(storeId);
  })().catch(() => {
    // Failures are recorded on the ProductSource and shown in the dashboard.
  });
}
