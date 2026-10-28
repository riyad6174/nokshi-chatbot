import { prisma } from "@/lib/db/prisma";

export type KnowledgeHit = {
  title: string;
  snippet: string;
  score: number;
  sourceType: string;
};

function buildSnippet(content: string, query: string): string {
  const normalized = content.toLowerCase();
  const needle = query.toLowerCase().trim();
  const index = needle ? normalized.indexOf(needle) : -1;
  const start = index > 120 ? index - 120 : 0;
  const end = Math.min(content.length, (index > -1 ? index : 0) + 420);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < content.length ? "..." : "";
  return `${prefix}${content.slice(start, end).trim()}${suffix}`;
}

export async function searchKnowledge(storeId: string, query: string, limit = 3): Promise<KnowledgeHit[]> {
  const documents = await prisma.knowledgeDocument.findMany({
    where: { storeId, status: "ready" },
    orderBy: { updatedAt: "desc" },
  });

  const normalized = query.trim().toLowerCase();
  const tokens = normalized.split(/\s+/).filter((token) => token.length > 1);

  const hits = documents
    .map((doc) => {
      const title = doc.title.toLowerCase();
      const content = doc.content.toLowerCase();
      let score = 0;
      if (normalized) {
        if (title === normalized) score += 15;
        else if (title.includes(normalized)) score += 8;
        if (content.includes(normalized)) score += 5;
        for (const token of tokens) {
          if (title.includes(token)) score += 4;
          if (content.includes(token)) score += 1;
        }
        if (score === 0) return null;
      } else {
        score = 1;
      }
      return {
        title: doc.title,
        snippet: buildSnippet(doc.content, normalized),
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
