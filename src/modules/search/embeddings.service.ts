import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";

// Optional semantic search. Product and knowledge texts are embedded with any OpenAI-compatible
// /embeddings endpoint and the vectors are stored on the documents themselves (no new database).
// Similarity is computed either in the app (VECTOR_SEARCH=local, fine for catalogs up to a few
// thousand products) or by MongoDB Atlas Vector Search (VECTOR_SEARCH=atlas, needs a vector index on
// the `embedding` field; see docs). Keyword search always runs; embeddings only add recall
// ("something to carry my laptop" -> backpacks) and multilingual matching.
//
// Cost: one embedding per product/document when its text changes, plus one per search query that
// keyword search alone can't answer. With text-embedding-3-small that is a few cents per 10,000.

const configSchema = z.object({
  EMBEDDINGS_PROVIDER: z.enum(["off", "openai-compatible"]).default("off"),
  EMBEDDINGS_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  EMBEDDINGS_API_KEY: z.string().default(""),
  EMBEDDINGS_MODEL: z.string().min(1).default("text-embedding-3-small"),
  EMBEDDINGS_DIMENSIONS: z.coerce.number().int().min(16).max(4096).optional(),
  VECTOR_SEARCH: z.enum(["local", "atlas"]).default("local"),
  ATLAS_VECTOR_INDEX_PRODUCTS: z.string().default("product_embedding"),
  ATLAS_VECTOR_INDEX_KNOWLEDGE: z.string().default("knowledge_embedding"),
  SEMANTIC_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.35),
});

export type EmbeddingsConfig = z.infer<typeof configSchema>;

const blank = (value: string | undefined) => (value && value.trim() ? value.trim() : undefined);

export function embeddingsConfig(): EmbeddingsConfig | null {
  const parsed = configSchema.safeParse({
    EMBEDDINGS_PROVIDER: blank(process.env.EMBEDDINGS_PROVIDER),
    EMBEDDINGS_BASE_URL: blank(process.env.EMBEDDINGS_BASE_URL),
    EMBEDDINGS_API_KEY: process.env.EMBEDDINGS_API_KEY ?? "",
    EMBEDDINGS_MODEL: blank(process.env.EMBEDDINGS_MODEL),
    EMBEDDINGS_DIMENSIONS: blank(process.env.EMBEDDINGS_DIMENSIONS),
    VECTOR_SEARCH: blank(process.env.VECTOR_SEARCH),
    ATLAS_VECTOR_INDEX_PRODUCTS: blank(process.env.ATLAS_VECTOR_INDEX_PRODUCTS),
    ATLAS_VECTOR_INDEX_KNOWLEDGE: blank(process.env.ATLAS_VECTOR_INDEX_KNOWLEDGE),
    SEMANTIC_MIN_SCORE: blank(process.env.SEMANTIC_MIN_SCORE),
  });
  if (!parsed.success) {
    logger.warn("embeddings.config_invalid", { issues: parsed.error.issues.map((issue) => issue.path.join(".")) });
    return null;
  }
  if (parsed.data.EMBEDDINGS_PROVIDER === "off") return null;
  return { ...parsed.data, EMBEDDINGS_BASE_URL: parsed.data.EMBEDDINGS_BASE_URL.replace(/\/+$/, "") };
}

export function semanticSearchEnabled(featureFlag = true): boolean {
  return featureFlag && embeddingsConfig() !== null;
}

export function textHash(text: string, model: string): string {
  return createHash("sha256").update(`${model}\n${text}`).digest("hex").slice(0, 32);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index]! * b[index]!;
    na += a[index]! * a[index]!;
    nb += b[index]! * b[index]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export async function embedTexts(texts: string[], config = embeddingsConfig()): Promise<number[][]> {
  if (!config || texts.length === 0) return [];
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${config.EMBEDDINGS_BASE_URL}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(config.EMBEDDINGS_API_KEY ? { Authorization: `Bearer ${config.EMBEDDINGS_API_KEY}` } : {}) },
      body: JSON.stringify({
        model: config.EMBEDDINGS_MODEL,
        input: texts.map((text) => text.slice(0, 8000)),
        ...(config.EMBEDDINGS_DIMENSIONS ? { dimensions: config.EMBEDDINGS_DIMENSIONS } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const body = (await response.json()) as { data?: Array<{ embedding?: number[]; index?: number }> };
      const rows = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      return rows.map((row) => (Array.isArray(row.embedding) ? row.embedding.map(Number) : []));
    }
    const retryable = response.status === 429 || response.status >= 500;
    await response.body?.cancel().catch(() => undefined);
    if (!retryable || attempt >= 1) throw new Error(`Embeddings request failed (${response.status}).`);
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
}

// Recent query vectors, so the same search (or a retry) doesn't pay twice.
const queryCache = new Map<string, number[]>();

async function embedQuery(query: string, config: EmbeddingsConfig): Promise<number[] | null> {
  const key = `${config.EMBEDDINGS_MODEL}|${query.trim().toLowerCase()}`;
  const cached = queryCache.get(key);
  if (cached) return cached;
  const [vector] = await embedTexts([query], config);
  if (!vector?.length) return null;
  queryCache.set(key, vector);
  if (queryCache.size > 300) queryCache.delete(queryCache.keys().next().value!);
  return vector;
}

export function productEmbeddingText(product: {
  name: string;
  category: string;
  brand: string;
  description: string;
  attributes: string;
  variants?: Array<{ title: string }>;
}): string {
  let attributes = "";
  try {
    attributes = Object.entries(JSON.parse(product.attributes || "{}") as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join("; ");
  } catch {
    attributes = "";
  }
  return [product.name, product.category, product.brand, attributes, product.variants?.map((variant) => variant.title).join(", "), product.description.slice(0, 600)]
    .filter(Boolean)
    .join("\n");
}

/** Embeds products whose text changed since their vector was made. Returns how many were updated. */
export async function refreshProductEmbeddings(storeId: string, limit = 500): Promise<number> {
  const config = embeddingsConfig();
  if (!config) return 0;
  const products = await prisma.product.findMany({
    where: { storeId, status: "active" },
    include: { variants: { select: { title: true } } },
    take: 5000,
  });
  const stale = products
    .map((product) => ({ product, text: productEmbeddingText(product) }))
    .map((entry) => ({ ...entry, hash: textHash(entry.text, config.EMBEDDINGS_MODEL) }))
    .filter((entry) => entry.product.embeddingHash !== entry.hash || entry.product.embedding.length === 0)
    .slice(0, limit);
  for (let start = 0; start < stale.length; start += 64) {
    const batch = stale.slice(start, start + 64);
    const vectors = await embedTexts(batch.map((entry) => entry.text), config);
    await Promise.all(
      batch.map((entry, index) =>
        vectors[index]?.length
          ? prisma.product.update({ where: { id: entry.product.id }, data: { embedding: vectors[index], embeddingHash: entry.hash } })
          : Promise.resolve(null),
      ),
    );
  }
  return stale.length;
}

export async function refreshKnowledgeEmbeddings(storeId: string): Promise<number> {
  const config = embeddingsConfig();
  if (!config) return 0;
  const documents = await prisma.knowledgeDocument.findMany({ where: { storeId, status: "ready" } });
  const stale = documents
    .map((doc) => ({ doc, text: `${doc.title}\n${doc.content.slice(0, 6000)}` }))
    .map((entry) => ({ ...entry, hash: textHash(entry.text, config.EMBEDDINGS_MODEL) }))
    .filter((entry) => entry.doc.embeddingHash !== entry.hash || entry.doc.embedding.length === 0);
  for (let start = 0; start < stale.length; start += 32) {
    const batch = stale.slice(start, start + 32);
    const vectors = await embedTexts(batch.map((entry) => entry.text), config);
    await Promise.all(
      batch.map((entry, index) =>
        vectors[index]?.length
          ? prisma.knowledgeDocument.update({ where: { id: entry.doc.id }, data: { embedding: vectors[index], embeddingHash: entry.hash } })
          : Promise.resolve(null),
      ),
    );
  }
  return stale.length;
}

type Scored = Array<{ id: string; score: number }>;

async function atlasVectorSearch(collection: string, index: string, vector: number[], storeId: string, limit: number, extraFilter: Record<string, unknown>): Promise<Scored> {
  const response = (await prisma.$runCommandRaw({
    aggregate: collection,
    pipeline: [
      {
        $vectorSearch: {
          index,
          path: "embedding",
          queryVector: vector,
          numCandidates: Math.max(limit * 12, 60),
          limit,
          filter: { storeId: { $oid: storeId }, ...extraFilter },
        },
      },
      { $project: { _id: 1, score: { $meta: "vectorSearchScore" } } },
    ],
    cursor: {},
  })) as { cursor?: { firstBatch?: Array<{ _id: { $oid?: string } | string; score: number }> } };
  return (response.cursor?.firstBatch ?? []).map((row) => ({
    id: typeof row._id === "string" ? row._id : row._id.$oid ?? "",
    score: Number(row.score),
  }));
}

/** Products semantically close to the query, best first, above the similarity threshold. */
export async function semanticProductMatches(storeId: string, query: string, limit = 8): Promise<Scored> {
  const config = embeddingsConfig();
  if (!config || !query.trim()) return [];
  const vector = await embedQuery(query, config);
  if (!vector) return [];
  let scored: Scored;
  if (config.VECTOR_SEARCH === "atlas") {
    scored = await atlasVectorSearch("Product", config.ATLAS_VECTOR_INDEX_PRODUCTS, vector, storeId, limit, { status: "active" });
  } else {
    const products = await prisma.product.findMany({ where: { storeId, status: "active" }, select: { id: true, embedding: true } });
    scored = products.map((product) => ({ id: product.id, score: cosineSimilarity(vector, product.embedding) }));
  }
  return scored
    .filter((entry) => entry.id && entry.score >= config.SEMANTIC_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Knowledge documents semantically close to the query (id -> similarity). */
export async function semanticKnowledgeMatches(storeId: string, query: string, limit = 5): Promise<Map<string, number>> {
  const config = embeddingsConfig();
  if (!config || !query.trim()) return new Map();
  const vector = await embedQuery(query, config);
  if (!vector) return new Map();
  let scored: Scored;
  if (config.VECTOR_SEARCH === "atlas") {
    scored = await atlasVectorSearch("KnowledgeDocument", config.ATLAS_VECTOR_INDEX_KNOWLEDGE, vector, storeId, limit, { status: "ready" });
  } else {
    const docs = await prisma.knowledgeDocument.findMany({ where: { storeId, status: "ready" }, select: { id: true, embedding: true } });
    scored = docs.map((doc) => ({ id: doc.id, score: cosineSimilarity(vector, doc.embedding) }));
  }
  return new Map(scored.filter((entry) => entry.score >= config.SEMANTIC_MIN_SCORE).map((entry) => [entry.id, entry.score]));
}
