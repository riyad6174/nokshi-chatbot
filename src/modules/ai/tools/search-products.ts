import { z } from "zod";
import { computeFacets, searchProducts } from "@/modules/catalog/product.service";
import { translateShoppingTerms } from "@/modules/catalog/query-terms";
import { resolveSalesConfig } from "@/modules/sales/config";
import { trackEvent } from "@/modules/customers/events.service";
import { semanticProductMatches, semanticSearchEnabled } from "@/modules/search/embeddings.service";
import { logger } from "@/lib/logging/logger";
import { productCompact, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";
import type { ChatPart, ProductCardData } from "@/types/chat";

const schema = z.object({
  query: z.string().trim().max(300).optional(),
  category: z.string().trim().max(100).optional(),
  brand: z.string().trim().max(100).optional(),
  filters: z.record(z.string().max(40), z.string().max(80)).optional(),
  minPriceMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  maxPriceMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  limit: z.number().int().min(1).max(8).optional(),
});

// Words that make up "what do you have?"-style questions, in English and Bangla.
const GENERAL_WORDS = new Set(
  [
    "all", "any", "anything", "everything", "product", "products", "item", "items", "stuff", "catalog", "catalogue",
    "collection", "what", "which", "do", "does", "you", "your", "have", "has", "sell", "show", "me", "see", "available",
    "সব", "সকল", "সবকিছু", "প্রোডাক্ট", "পণ্য", "কি", "কী", "কোন", "জিনিস", "আপনাদের", "আপনার", "কাছে", "আছে",
    "দেখান", "দেখাও", "দেখাবেন", "আমাকে", "কিছু", "বিক্রি", "করেন", "রকম",
    "list", "price", "prices", "the", "a", "of", "and", "are", "there", "can", "i", "is", "available", "browse", "store", "shop",
    // Bangla written in English letters ("ki ki product ache?", "sob product dekhan").
    "ki", "kii", "ky", "kon", "konta", "koto", "ache", "achhe", "ase", "asey", "achey", "apnader", "apnar", "tomader",
    "kache", "sob", "shob", "sobgula", "sobgulo", "dekhan", "dekhao", "dekhaben", "dekhi", "amake", "kichu", "jinish",
    "bikri", "koren", "rokom", "chai", "dam", "list", "pannya", "ponno",
    "আর", "এর", "দাম", "লিস্ট", "তালিকা", "দেখি", "দেখতে", "চাই", "সমস্ত", "যা", "যত", "সবগুলো", "সবগুলা", "প্রোডাক্টস", "পন্য",
  ].map((word) => word.normalize("NFC")),
);

/** "products", "সব প্রোডাক্ট", "what do you have": a request to browse rather than for something specific. */
function isGeneralQuery(query: string): boolean {
  const words = query.normalize("NFC").toLowerCase().split(/[\s,।?!.]+/).filter(Boolean);
  return words.every((word) => GENERAL_WORDS.has(word));
}

/** How many products a "show me everything" browse puts on screen. */
const BROWSE_LIMIT = 24;

/** Up to `limit` products, one per category first, so a browse shows the range of the store. */
async function browseSelection(
  run: (text: string | undefined, category: string | undefined) => Promise<ProductCardData[]>,
  limit: number,
): Promise<ProductCardData[]> {
  const all = await run(undefined, undefined);
  const firstOfEach = all.filter((product, index) => all.findIndex((other) => other.category === product.category) === index);
  const rest = all.filter((product) => !firstOfEach.includes(product));
  return [...firstOfEach, ...rest].slice(0, limit);
}

export const searchProductsTool: ToolDefinition = {
  name: "search_products",
  description:
    "Search the catalog. Use for every product, availability or price question; NO query shows a selection of all products. Returns products and `facets` (brands, colors, sizes, materials in the results). With several matches, ask ONE short question from the facets, then search again with `filters`/`brand`. Price filters are in minor units (100 = 1 BDT).",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", description: "English catalog words (translate Bangla: ব্যাগ -> bag, জামা -> clothing), e.g. 'gift for dad'. Several items in one call: 'bag clothing'." },
      category: { type: "string", description: "Category filter, e.g. Bags, Clothing." },
      brand: { type: "string", description: "Brand filter." },
      filters: {
        type: "object",
        description: "Narrow by variant option or attribute, e.g. {\"color\":\"Black\"} or {\"material\":\"canvas\"}.",
        additionalProperties: { type: "string" },
      },
      minPriceMinor: { type: "integer", minimum: 0 },
      maxPriceMinor: { type: "integer", minimum: 0, description: "300000 = 3,000 BDT." },
      limit: { type: "integer", minimum: 1, maximum: 8, description: "Default 6." },
    },
  },
  schema,
  parallelSafe: true,
  async execute(ctx, args) {
    const input = schema.parse(args);
    const run = (text: string | undefined, category: string | undefined) =>
      searchProducts({
        storeId: ctx.session.storeId,
        text,
        category,
        brand: input.brand,
        filters: input.filters,
        minPriceMinor: input.minPriceMinor,
        maxPriceMinor: input.maxPriceMinor,
        limit: text === undefined && category === undefined ? BROWSE_LIMIT : input.limit ?? 6,
      });

    // "What products do you have?" / "সব প্রোডাক্ট দেখান": show the whole range straight away.
    // Searching those words as text would match descriptions by accident ("all" in "small").
    const browseOnly =
      (!input.query || isGeneralQuery(input.query)) &&
      !input.category &&
      !input.brand &&
      !input.filters &&
      input.minPriceMinor === undefined &&
      input.maxPriceMinor === undefined;
    if (browseOnly) {
      const selection = await browseSelection(run, BROWSE_LIMIT);
      const categories = [...new Set(selection.map((product) => product.category))];
      return success(
        {
          matched: selection.length > 0,
          count: selection.length,
          products: selection.map((product) => productCompact(product, { brief: true })),
          storeCategories: categories,
          note:
            selection.length > 0
              ? `All ${selection.length} products are on screen as cards (categories: ${categories.join(", ")}). Don't list them; say in one short sentence that these are the products, and ask which one they like.`
              : "The store has no products available right now. Say so briefly.",
        },
        selection.length > 0 ? [{ type: "product_list", products: selection, label: "Our products" }] : undefined,
      );
    }
    // Drop "show me", "do you have" etc. so "show me bags" searches for "bags".
    if (input.query) {
      const specific = input.query
        .normalize("NFC")
        .split(/[\s,।?!.]+/)
        .filter((word) => word && !GENERAL_WORDS.has(word.toLowerCase()))
        .join(" ");
      if (specific) input.query = specific;
    }

    // Bangla words -> catalog terms, then each recognized term on its own ("ব্যাগ আর জামা").
    const salesConfig = resolveSalesConfig(ctx.session.store.settings);
    const synonyms = salesConfig.synonyms;
    let products = await run(input.query, input.category);
    // Few keyword matches: add semantically close products (natural-language needs, other languages).
    if (products.length < 3 && input.query && semanticSearchEnabled(salesConfig.features.semanticSearch)) {
      const semantic = await semanticProductMatches(ctx.session.storeId, input.query, 8).catch((error) => {
        logger.warn("search.semantic_failed", { error: error instanceof Error ? error.message : String(error) });
        return [];
      });
      if (semantic.length > 0) {
        products = await searchProducts({
          storeId: ctx.session.storeId,
          text: input.query,
          category: input.category,
          brand: input.brand,
          filters: input.filters,
          minPriceMinor: input.minPriceMinor,
          maxPriceMinor: input.maxPriceMinor,
          limit: input.limit ?? 6,
          semanticScores: new Map(semantic.map((entry) => [entry.id, entry.score])),
        });
      }
    }
    if (products.length === 0) {
      const translated = translateShoppingTerms(`${input.query ?? ""} ${input.category ?? ""}`, synonyms);
      const category = input.category && translateShoppingTerms(input.category, synonyms) ? undefined : input.category;
      if (translated) {
        products = await run(translated, category);
        if (products.length === 0) {
          const seen = new Set<string>();
          for (const term of translated.split(" ")) {
            for (const product of await run(term, category)) {
              if (!seen.has(product.id)) {
                seen.add(product.id);
                products.push(product);
              }
            }
          }
          products = products.slice(0, input.limit ?? 6);
        }
      }
    }
    // Nothing matched. Only a browsing question ("what do you have?") gets a selection of cards;
    // anything else gets no cards (the customer didn't ask to see those products), just the store's
    // categories so the assistant can say what it does sell.
    const matched = products.length > 0;
    const asked = `${input.query ?? ""} ${input.category ?? ""} ${input.brand ?? ""}`.trim();
    const general = !asked || (!translateShoppingTerms(asked) && isGeneralQuery(asked));
    let categories = [...new Set(products.map((product) => product.category))];
    if (!matched) {
      const selection = await browseSelection(run, general ? BROWSE_LIMIT : input.limit ?? 6);
      categories = [...new Set(selection.map((product) => product.category))];
      if (general) products = selection;
    }
    const facets = matched && products.length > 1 ? computeFacets(products) : [];
    if (asked) {
      void trackEvent({
        storeId: ctx.session.storeId,
        sessionId: ctx.session.sessionId,
        visitorId: ctx.session.visitorId,
        type: "searched",
        meta: { query: asked.slice(0, 120), matched, count: matched ? products.length : 0, productIds: matched ? products.map((product) => product.id) : [] },
      });
    }

    const ui: ChatPart[] = [];
    if (products.length > 0) {
      const label = matched
        ? input.query || input.category || input.brand
          ? `Results for “${input.query || input.category || input.brand}”`
          : "Products for you"
        : "Our products";
      ui.push({ type: "product_list", products, label });
    }
    if (facets.length > 0) ui.push({ type: "refine_options", options: { query: input.query ?? input.category ?? "", facets } });

    const cardsNote = "The product cards are on screen. Don't list or describe them; say one short sentence and ask one question.";
    return success(
      {
        matched,
        count: products.length,
        products: products.map((product) => productCompact(product, { brief: products.length > 2 })),
        facets,
        storeCategories: categories,
        note: matched
          ? `${cardsNote} Your top pick and why, in a few words.`
          : general
            ? `${cardsNote} These are a selection of the store's products (categories: ${categories.join(", ")}); ask which they like or what they're looking for.`
            : `Nothing matched "${asked}" and nothing is on screen. Say in a few words that the store doesn't have that, and offer these categories instead: ${categories.join(", ")}. Don't show or search other products unless the customer asks.`,
      },
      ui.length > 0 ? ui : undefined,
    );
  },
};
