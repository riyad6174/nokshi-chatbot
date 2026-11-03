import { z } from "zod";
import { computeFacets, searchProducts } from "@/modules/catalog/product.service";
import { translateShoppingTerms } from "@/modules/catalog/query-terms";
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
  ].map((word) => word.normalize("NFC")),
);

/** "products", "সব প্রোডাক্ট", "what do you have": a request to browse rather than for something specific. */
function isGeneralQuery(query: string): boolean {
  const words = query.normalize("NFC").toLowerCase().split(/[\s,।?!.]+/).filter(Boolean);
  return words.every((word) => GENERAL_WORDS.has(word));
}

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
    "Search the store's active catalog. Use for every recommendation, availability or price question. Returns products plus `facets` (brands, colors, sizes, materials present in the results). When there are several matches, ask ONE short question using the facets to narrow down (e.g. which color or brand), then search again with `filters`/`brand`. Prices are integers in minor units (100 = 1 BDT).",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", description: "Free text in English catalog words (translate Bangla: ব্যাগ -> bag, ঘড়ি -> watch, জামা -> clothing), e.g. 'backpack', 'gift for dad', 'cotton panjabi'. Search several items in one call: 'bag clothing'." },
      category: { type: "string", description: "Category filter, e.g. Bags, Electronics, Clothing, Home, Accessories." },
      brand: { type: "string", description: "Brand filter." },
      filters: {
        type: "object",
        description: "Narrow by variant option or attribute, e.g. {\"color\":\"Black\"} or {\"material\":\"canvas\"}.",
        additionalProperties: { type: "string" },
      },
      minPriceMinor: { type: "integer", minimum: 0, description: "Minimum unit price in minor units." },
      maxPriceMinor: { type: "integer", minimum: 0, description: "Maximum unit price in minor units. 300000 = 3,000 BDT." },
      limit: { type: "integer", minimum: 1, maximum: 8, description: "Number of products to return (default 6)." },
    },
  },
  schema,
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
        limit: text === undefined && category === undefined ? 12 : input.limit ?? 6,
      });

    // Bangla words -> catalog terms, then each recognized term on its own ("ব্যাগ আর জামা").
    let products = await run(input.query, input.category);
    if (products.length === 0) {
      const translated = translateShoppingTerms(`${input.query ?? ""} ${input.category ?? ""}`);
      const category = input.category && translateShoppingTerms(input.category) ? undefined : input.category;
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
      const selection = await browseSelection(run, input.limit ?? 6);
      categories = [...new Set(selection.map((product) => product.category))];
      if (general) products = selection;
    }
    const facets = matched && products.length > 1 ? computeFacets(products) : [];

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
        products: products.map(productCompact),
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
