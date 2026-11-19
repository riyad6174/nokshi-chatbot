import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import { translateShoppingTerms } from "@/modules/catalog/query-terms";
import { semanticKnowledgeMatches, semanticSearchEnabled } from "@/modules/search/embeddings.service";
import { fold, stems } from "@/modules/sales/matching";

export type KnowledgeHit = {
  documentId: string;
  version: number | null;
  title: string;
  snippet: string;
  score: number;
  sourceType: string;
};

// Policy/FAQ retrieval: documents are split into paragraph chunks, each chunk is scored on word stems
// with policy synonyms ("refund" also finds "return", "money back"), Bangla and Banglish terms, plus an
// optional semantic boost from embeddings. The best chunk of each document is the excerpt.

const STOPWORDS = new Set(["the", "a", "an", "is", "are", "do", "does", "you", "your", "i", "my", "me", "can", "what", "how", "to", "of", "for", "in", "on", "and", "or", "it", "with", "about", "please", "tell"]);

const POLICY_SYNONYMS: string[][] = [
  ["refund", "return", "money back", "exchange", "replace", "ফেরত", "রিটার্ন", "রিফান্ড", "ferot"],
  ["delivery", "shipping", "courier", "ship", "deliver", "ডেলিভারি", "পাঠাবেন", "kobe pabo"],
  ["payment", "pay", "cash on delivery", "cod", "bkash", "nagad", "card", "পেমেন্ট", "বিকাশ", "টাকা"],
  ["warranty", "guarantee", "ওয়ারেন্টি", "গ্যারান্টি"],
  ["size", "fit", "measurement", "সাইজ", "মাপ"],
  ["cancel", "cancellation", "বাতিল"],
  ["contact", "phone", "support", "help", "যোগাযোগ"],
  ["care", "wash", "clean", "maintenance"],
];

/** A chunk this size holds a whole policy point (e.g. a delivery-time table) without bloating the prompt. */
const CHUNK_TARGET = 650;
const CHUNK_MAX = 800;
/** Below this, a match is one incidental shared word ("delivery" in a returns policy): not a hit. */
const MIN_SCORE = 3;
/** Hits far weaker than the best one are noise that only confuses the model. */
const RELATIVE_CUTOFF = 0.35;
/** A keyword match this strong is already right; skip the embeddings call. */
const STRONG_KEYWORD_SCORE = 8;

function expandTerms(query: string): string[] {
  const lower = query.normalize("NFC").toLowerCase();
  const base = stems(lower).filter((word) => !STOPWORDS.has(word));
  const extra: string[] = [];
  for (const group of POLICY_SYNONYMS) {
    if (group.some((term) => lower.includes(term))) extra.push(...group.filter((term) => /^[a-z ]+$/.test(term)));
  }
  const translated = translateShoppingTerms(query);
  return [...new Set([...base, ...stems(extra.join(" ")), ...stems(translated)].map(fold))].filter((word) => word.length > 1);
}

function wordSet(text: string): Set<string> {
  return new Set(stems(text).map(fold));
}

type Chunk = { text: string; lower: string; words: Set<string> };

const chunkCache = new Map<string, Chunk[]>();

/** Paragraph chunks of ~650 characters; long paragraphs are split on sentence ends. */
export function chunkDocument(content: string): string[] {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((paragraph) => {
      if (paragraph.length <= CHUNK_MAX) return [paragraph];
      const sentences = paragraph.split(/(?<=[.!?।])\s+/);
      const parts: string[] = [];
      let current = "";
      for (const sentence of sentences) {
        if (current && current.length + sentence.length + 1 > CHUNK_TARGET) {
          parts.push(current);
          current = "";
        }
        current = current ? `${current} ${sentence}` : sentence;
      }
      if (current) parts.push(current);
      return parts.map((part) => (part.length > CHUNK_MAX ? `${part.slice(0, CHUNK_MAX)}...` : part));
    });
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 1 > CHUNK_TARGET) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n${paragraph}` : paragraph;
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [content.slice(0, CHUNK_MAX)];
}

function contentKey(text: string): string {
  // FNV-1a: cheap and good enough to notice an edited document.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

function chunksFor(doc: { id: string; content: string }): Chunk[] {
  const key = `${doc.id}:${contentKey(doc.content)}`;
  const cached = chunkCache.get(key);
  if (cached) return cached;
  const chunks = chunkDocument(doc.content).map((text) => ({ text, lower: text.toLowerCase(), words: wordSet(text) }));
  if (chunkCache.size > 500) chunkCache.clear();
  chunkCache.set(key, chunks);
  return chunks;
}

export async function searchKnowledge(storeId: string, query: string, limit = 3, options: { semantic?: boolean } = {}): Promise<KnowledgeHit[]> {
  const documents = await prisma.knowledgeDocument.findMany({
    where: { storeId, status: "ready" },
    orderBy: { title: "asc" },
  });

  const normalized = query.trim().toLowerCase();
  const terms = expandTerms(normalized);
  const max = Math.min(Math.max(limit, 1), 5);

  const keywordScored = documents.map((doc) => {
    const title = doc.title.toLowerCase();
    let titleScore = 0;
    if (normalized) {
      if (title === normalized) titleScore += 15;
      else if (title.includes(normalized)) titleScore += 8;
      const titleWords = wordSet(title);
      for (const term of terms) if (titleWords.has(term)) titleScore += 4;
      // Keywords and related questions the admin added are as telling as the title.
      const extra = `${doc.keywords ?? ""} ${doc.relatedQuestions ?? ""}`.trim();
      if (extra) {
        const extraWords = wordSet(extra.toLowerCase());
        for (const term of terms) if (extraWords.has(term) && !titleWords.has(term)) titleScore += 3;
      }
    }
    let bestChunk: Chunk | null = null;
    let bestChunkScore = -1;
    for (const chunk of chunksFor(doc)) {
      let score = 0;
      if (normalized && chunk.lower.includes(normalized)) score += 5;
      for (const term of terms) if (chunk.words.has(term)) score += 1;
      if (score > bestChunkScore) {
        bestChunkScore = score;
        bestChunk = chunk;
      }
    }
    return { doc, keyword: titleScore + Math.max(bestChunkScore, 0), snippet: bestChunk?.text ?? doc.content.slice(0, CHUNK_MAX) };
  });

  if (!normalized) {
    return keywordScored.slice(0, max).map(({ doc, snippet }) => toHit(doc, snippet, 1));
  }

  const strongKeyword = keywordScored.some((entry) => entry.keyword >= STRONG_KEYWORD_SCORE);
  const semantic =
    !strongKeyword && options.semantic !== false && semanticSearchEnabled()
      ? await semanticKnowledgeMatches(storeId, query).catch((error) => {
          logger.warn("knowledge.semantic_failed", { error: error instanceof Error ? error.message : String(error) });
          return new Map<string, number>();
        })
      : new Map<string, number>();

  const scored = keywordScored
    .map((entry) => {
      const similarity = semantic.get(entry.doc.id) ?? 0;
      // A confident semantic match counts on its own, even without shared words.
      const score = entry.keyword + similarity * 10;
      return { ...entry, score, passes: entry.keyword >= MIN_SCORE || similarity > 0 };
    })
    .filter((entry) => entry.passes && entry.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title));

  const top = scored[0]?.score ?? 0;
  return scored
    .filter((entry) => entry.score >= top * RELATIVE_CUTOFF)
    .slice(0, max)
    .map(({ doc, snippet, score }) => toHit(doc, snippet, score));
}

function toHit(
  doc: { id: string; version: number | null; title: string; sourceType: string },
  snippet: string,
  score: number,
): KnowledgeHit {
  return { documentId: doc.id, version: doc.version ?? null, title: doc.title, snippet, score, sourceType: doc.sourceType };
}

export async function listKnowledgeForAdmin(storeId: string) {
  return prisma.knowledgeDocument.findMany({
    where: { storeId },
    orderBy: { updatedAt: "desc" },
  });
}
