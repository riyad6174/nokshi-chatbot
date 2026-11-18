import { z } from "zod";
import { searchKnowledge } from "@/modules/knowledge/retrieval.service";
import { findCachedKnowledgeAnswer, rememberCachedKnowledgeAnswer } from "@/modules/knowledge/answer-cache.service";
import { captureUnansweredQuestion } from "@/modules/knowledge/learning.service";
import { trackEvent } from "@/modules/customers/events.service";
import { resolveSalesConfig } from "@/modules/sales/config";
import { success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";

const schema = z.object({
  query: z.string().trim().min(1).max(300),
});

export const searchKnowledgeTool: ToolDefinition = {
  name: "search_knowledge",
  description:
    "Search the store's policy and FAQ documents (shipping, returns, payments, care, warranty) for policy questions; cite the document title.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string", description: "Policy or FAQ keywords, e.g. 'delivery time inside Dhaka'." },
    },
  },
  schema,
  parallelSafe: true,
  async execute(ctx, args) {
    const input = schema.parse(args);
    const config = resolveSalesConfig(ctx.session.store.settings);
    const cacheEligible =
      ctx.session.store.settings?.answerCacheEnabled === true &&
      (ctx.cartItemCount ?? 0) === 0 &&
      ctx.openOrder !== true;
    if (cacheEligible) {
      const cached = await findCachedKnowledgeAnswer(ctx.session.storeId, ctx.latestUserText || input.query);
      if (cached) {
        void trackEvent({
          storeId: ctx.session.storeId,
          sessionId: ctx.session.sessionId,
          visitorId: ctx.session.visitorId,
          type: "searched",
          meta: { scope: "knowledge", query: input.query.slice(0, 120), matched: true, cached: true },
        });
        return success({
          count: 1,
          results: [{ title: cached.title, excerpt: cached.answer, sourceType: "cache" }],
          note: "Approved answer reused. Do not add facts the excerpt doesn't contain.",
        });
      }
    }
    const hits = await searchKnowledge(ctx.session.storeId, input.query, 3, { semantic: config.features.semanticSearch });
    // Questions the knowledge base can't answer show up in Analytics as missing information.
    void trackEvent({
      storeId: ctx.session.storeId,
      sessionId: ctx.session.sessionId,
      visitorId: ctx.session.visitorId,
      type: "searched",
      meta: { scope: "knowledge", query: input.query.slice(0, 120), matched: hits.length > 0, count: hits.length },
    });
    if (hits.length === 0) {
      void captureUnansweredQuestion({
        storeId: ctx.session.storeId,
        conversationId: ctx.session.conversationId,
        question: ctx.latestUserText?.trim() || input.query,
        channel: ctx.channel ?? "text",
        intent: "knowledge",
        outcome: "missed",
        reason: "knowledge_search_empty",
      });
    } else if (cacheEligible && hits[0]) {
      void rememberCachedKnowledgeAnswer({
        storeId: ctx.session.storeId,
        question: ctx.latestUserText || input.query,
        hit: hits[0],
      });
    }
    return success({
      count: hits.length,
      results: hits.map((hit) => ({ title: hit.title, excerpt: hit.snippet, sourceType: hit.sourceType })),
      ...(hits.length === 0
        ? { note: "No approved document matched. Do not invent a policy; offer support@nokshibazaar.example." }
        : {}),
    });
  },
};
