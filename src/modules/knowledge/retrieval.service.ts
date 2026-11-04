import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import { translateShoppingTerms } from "@/modules/catalog/query-terms";
import { semanticKnowledgeMatches, semanticSearchEnabled } from "@/modules/search/embeddings.service";
import { fold, stems } from "@/modules/sales/matching";

export type KnowledgeHit = {
  title: string;
  snippet: string;
  score: number;
  sourceType: string;
};

// Policy/FAQ retrieval: keyword scoring on word stems with policy synonyms ("refund" also finds
// "return", "money back"), Bangla and Banglish terms, the best-matching paragraph as the excerpt,
// and an optional semantic boost from embeddings.

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

function bestParagraph(content: string, terms: string[]): string {
  const paragraphs = content.split(/\n\s*\n|(?<=[.!?।])\s+(?=[A-Zঀ-৿])/).filter((part) => part.trim());
  if (paragraphs.length === 0) return content.slice(0, 420);
  let best = 0;
  let bestScore = -1;
  paragraphs.forEach((paragraph, index) => {
    const words = wordSet(paragraph);
    const score = terms.filter((term) => words.has(term)).length;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  // The best paragraph plus following ones up to ~420 characters, for context.
  let snippet = "";
  for (let index = best; index < paragraphs.length && snippet.length < 420; index += 1) snippet += `${snippet ? " " : ""}${paragraphs[index]!.trim()}`;
  const trimmed = snippet.length > 480 ? `${snippet.slice(0, 480)}...` : snippet;
  return `${best > 0 ? "..." : ""}${trimmed}`;
}

export async function searchKnowledge(storeId: string, query: string, limit = 3, options: { semantic?: boolean } = {}): Promise<KnowledgeHit[]> {
  const documents = await prisma.knowledgeDocument.findMany({
    where: { storeId, status: "ready" },
    orderBy: { updatedAt: "desc" },
  });

  const normalized = query.trim().toLowerCase();
  const terms = expandTerms(normalized);
  const semantic =
    normalized && options.semantic !== false && semanticSearchEnabled()
      ? await semanticKnowledgeMatches(storeId, query).catch((error) => {
          logger.warn("knowledge.semantic_failed", { error: error instanceof Error ? error.message : String(error) });
          return new Map<string, number>();
        })
      : new Map<string, number>();

  const hits = documents
    .map((doc) => {
      const title = doc.title.toLowerCase();
      const content = doc.content.toLowerCase();
      let score = 0;
      if (normalized) {
        if (title === normalized) score += 15;
        else if (title.includes(normalized)) score += 8;
        if (content.includes(normalized)) score += 5;
        const titleWords = wordSet(title);
        const contentWords = wordSet(content);
        for (const term of terms) {
          if (titleWords.has(term)) score += 4;
          if (contentWords.has(term)) score += 1;
        }
        score += (semantic.get(doc.id) ?? 0) * 10;
        if (score === 0) return null;
      } else {
        score = 1;
      }
      return {
        title: doc.title,
        snippet: bestParagraph(doc.content, terms),
        score,
        sourceType: doc.sourceType,
      };
    })
    .filter((entry): entry is KnowledgeHit => entry !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Math.max(limit, 1), 5));

  return hits;
}

export async function listKnowledgeForAdmin(storeId: string) {
  return prisma.knowledgeDocument.findMany({
    where: { storeId },
    orderBy: { updatedAt: "desc" },
  });
}
