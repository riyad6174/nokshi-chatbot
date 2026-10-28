import { formatMinor } from "@/lib/money";
import { addItem, getActiveCart, getCartSummary, removeItem } from "@/modules/cart/cart.service";
import { computeFacets, searchProducts } from "@/modules/catalog/product.service";
import { findOrdersForCustomer, toOrderStatusData } from "@/modules/orders/order.service";
import type { OrchestratorEvent } from "@/modules/ai/orchestrator";
import type { SessionContext } from "@/modules/conversations/session.service";
import { searchKnowledge } from "@/modules/knowledge/retrieval.service";
import type { CartPayload, ChatPart } from "@/types/chat";

function isBengali(text: string, locale: string): boolean {
  return /[\u0980-\u09FF]/.test(text) || locale.startsWith("bn");
}

function t(bengali: boolean, en: string, bn: string): string {
  return bengali ? bn : en;
}

function formatPrice(minor: number, currency: string): string {
  return formatMinor(minor, currency, "en-BD");
}

function detectBudgetMinor(text: string): number | undefined {
  const kMatch = text.match(/([\d.]+)\s*k\b/i);
  if (kMatch) {
    const value = Number.parseFloat(kMatch[1]);
    if (Number.isFinite(value) && value > 0) return Math.round(value * 1000 * 100);
  }
  const underMatch = text.match(
    /(?:under|below|within|less than|up to|max|budget|নিচে|কম|মধ্যে)\s*(?:৳|tk\.?|bdt|taka)?\s*([\d,]+(?:\.\d+)?)/i,
  );
  const currencyMatch = text.match(/([\d,]+(?:\.\d+)?)\s*(?:tk\.?|taka|bdt|৳)/i);
  const raw = underMatch?.[1] || currencyMatch?.[1];
  if (!raw) return undefined;
  const value = Number.parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 100);
}

function detectCategory(text: string): string | undefined {
  const normalized = text.toLowerCase();
  const categories: Array<{ category: string; terms: string[] }> = [
    { category: "Bags", terms: ["bag", "backpack", "tote", "ব্যাগ", "ব্যাকপ্যাক"] },
    { category: "Electronics", terms: ["earbud", "earphone", "headphone", "electronics", "ইয়ারবাড", "হেডফোন"] },
    { category: "Clothing", terms: ["panjabi", "shirt", "clothing", "পাঞ্জাবি", "জামা"] },
    { category: "Home", terms: ["tea set", "cup", "home", "চা", "কাপ", "টি সেট"] },
    { category: "Accessories", terms: ["scarf", "watch", "accessor", "স্কার্ফ", "ঘড়ি"] },
  ];
  for (const entry of categories) {
    if (entry.terms.some((term) => normalized.includes(term))) return entry.category;
  }
  return undefined;
}

function detectPolicyTopic(text: string): string | undefined {
  const normalized = text.toLowerCase();
  if (/(shipping|delivery|deliver|courier|ডেলিভারি|শিপিং|পাঠাতে)/.test(normalized)) return "shipping delivery time charge";
  if (/(return|refund|exchange|রিটার্ন|ফেরত|বদল)/.test(normalized)) return "return refund exchange policy";
  if (/(payment|pay|bkash|nagad|card|cod|পেমেন্ট|বিকাশ|টাকা দেও)/.test(normalized)) return "payment methods";
  if (/(warranty|guarantee|ওয়ারেন্টি|গ্যারান্টি)/.test(normalized)) return "warranty support";
  if (/(care|wash|clean|ধোয়া|যত্ন|পরিষ্কার)/.test(normalized)) return "product care";
  return undefined;
}

function chunkText(text: string): string[] {
  const sentences = text.match(/[^.!?।\n]+[.!?।]?/g) ?? [text];
  return sentences.map((sentence) => sentence.trim()).filter(Boolean);
}

async function* emitText(text: string): AsyncGenerator<OrchestratorEvent> {
  for (const chunk of chunkText(text)) {
    yield { type: "delta", text: chunk.endsWith(" ") ? chunk : `${chunk} ` };
  }
  if (text.trim() && !/[.!?।]$/.test(text.trim())) {
    yield { type: "delta", text: "\n" };
  }
}

type DemoResult = {
  text: string;
  parts?: ChatPart[];
  /** No useful answer; counts toward automatic handoff. */
  missed?: boolean;
};

async function handleOrderStatus(ctx: SessionContext, text: string, bengali: boolean): Promise<DemoResult> {
  const orderNumber = text.match(/\bNB-[A-Z0-9]{6}\b/i)?.[0];
  const phone = text.match(/\+?\d[\d\s-]{7,}\d/)?.[0];
  const { orders, verified } = await findOrdersForCustomer({
    storeId: ctx.storeId,
    sessionId: ctx.sessionId,
    orderNumber,
    phone,
  });
  if (orders.length > 0) {
    return {
      text: t(bengali, "Here's the latest on your order:", "আপনার অর্ডারের সর্বশেষ অবস্থা:"),
      parts: [{ type: "order_status", orders: orders.map(toOrderStatusData) }],
    };
  }
  if (orderNumber && !verified) {
    return {
      text: t(
        bengali,
        `To protect your privacy, please send the phone number used for ${orderNumber.toUpperCase()} together with the order number.`,
        `গোপনীয়তার জন্য, ${orderNumber.toUpperCase()} অর্ডারের ফোন নম্বরটি অর্ডার নম্বরসহ পাঠান।`,
      ),
    };
  }
  return {
    text: t(
      bengali,
      "Please send your order number (like NB-7K2QX9) and the phone number you ordered with.",
      "আপনার অর্ডার নম্বর (যেমন NB-7K2QX9) এবং অর্ডারের ফোন নম্বর পাঠান।",
    ),
  };
}

async function handleAdd(ctx: SessionContext, text: string, bengali: boolean): Promise<DemoResult> {
  const cleaned = text
    .replace(/(add|put|যোগ|কার্টে|to cart|cart)/gi, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const products = await searchProducts({
    storeId: ctx.storeId,
    text: cleaned || undefined,
    category: detectCategory(text),
    limit: 4,
  });

  if (products.length === 0) {
    return {
      text: t(
        bengali,
        "I could not find that product in our catalog. Try a broader name, or browse the product cards above.",
        "এই পণ্যটি ক্যাটালগে খুঁজে পাইনি। অন্য নামে খুঁজুন বা উপরের পণ্যের কার্ড থেকে বেছে নিন।",
      ),
    };
  }

  const product = products[0];
  if (products.length > 1) {
    return {
      text: t(
        bengali,
        "A few products could match. Please pick one from these cards and use its Add button.",
        "কয়েকটি পণ্য মিলতে পারে। কার্ড থেকে পছন্দের পণ্যটি বেছে নিয়ে Add বাটনে চাপ দিন।",
      ),
      parts: [{ type: "product_list", products }],
    };
  }

  let variantId: string | null = null;
  const availableVariants = product.variants.filter((variant) => variant.available);
  if (availableVariants.length === 0) {
    return {
      text: t(
        bengali,
        `${product.name} is currently out of stock.`,
        `${product.name} এই মুহূর্তে স্টকে নেই।`,
      ),
      parts: [{ type: "product_list", products: [product] }],
    };
  }
  if (availableVariants.length > 1) {
    const matched = availableVariants.find((variant) => text.toLowerCase().includes(variant.title.toLowerCase()));
    if (matched) variantId = matched.id;
    else {
      return {
        text: t(
          bengali,
          `${product.name} comes in ${availableVariants.map((variant) => variant.title).join(", ")}. Which variant would you like?`,
          `${product.name} পাওয়া যাচ্ছে ${availableVariants.map((variant) => variant.title).join(", ")}। কোনটি নেবেন?`,
        ),
        parts: [{ type: "product_list", products: [product] }],
      };
    }
  } else {
    variantId = availableVariants[0].id;
  }

  try {
    const cart = await addItem({
      sessionId: ctx.sessionId,
      storeId: ctx.storeId,
      currency: ctx.store.currency,
      productId: product.id,
      variantId,
      quantity: 1,
    });
    return {
      text: t(
        bengali,
        `Added ${product.name} to your cart. Your subtotal is ${formatPrice(cart.subtotalMinor, cart.currency)}.`,
        `${product.name} কার্টে যোগ করা হয়েছে। সাবটোটাল ${formatPrice(cart.subtotalMinor, cart.currency)}।`,
      ),
      parts: [{ type: "cart_summary", cart }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not add the item.";
    return { text: message };
  }
}

async function handleRemove(ctx: SessionContext, text: string, bengali: boolean): Promise<DemoResult> {
  const cart = await getActiveCart(ctx.sessionId, ctx.storeId);
  if (!cart || cart.items.length === 0) {
    return { text: t(bengali, "Your cart is already empty.", "আপনার কার্ট খালি।") };
  }
  const item = cart.items.find((entry) => text.toLowerCase().includes(entry.product.name.toLowerCase()));
  if (!item) {
    const summary = await getCartSummary(ctx.sessionId, ctx.storeId, ctx.store.currency);
    return {
      text: t(
        bengali,
        "I could not tell which line to remove. Use the minus or remove button in the cart panel.",
        "কোন পণ্যটি সরাতে হবে বুঝতে পারিনি। কার্ট প্যানেলের remove বাটন ব্যবহার করুন।",
      ),
      parts: [{ type: "cart_summary", cart: summary }],
    };
  }
  const summary = await removeItem({
    sessionId: ctx.sessionId,
    storeId: ctx.storeId,
    cartId: cart.id,
    itemId: item.id,
  });
  return {
    text: t(
      bengali,
      `Removed ${item.product.name}. Subtotal is now ${formatPrice(summary.subtotalMinor, summary.currency)}.`,
      `${item.product.name} সরানো হয়েছে। নতুন সাবটোটাল ${formatPrice(summary.subtotalMinor, summary.currency)}।`,
    ),
    parts: [{ type: "cart_summary", cart: summary }],
  };
}

export async function* runDemoAssistant(input: {
  session: SessionContext;
  cart: CartPayload;
  userText: string;
}): AsyncGenerator<OrchestratorEvent> {
  const { session, cart, userText } = input;
  const bengali = isBengali(userText, session.locale);
  const text = userText.trim();
  const lower = text.toLowerCase();
  const currency = session.store.currency;

  let result: DemoResult;

  if (/^(i'?m |i am )?(looking for a product|help me find something|i want to buy something)\.?$/i.test(lower)) {
    const all = await searchProducts({ storeId: session.storeId, limit: 12 });
    const categories = [...new Set(all.map((product) => product.category))].slice(0, 6);
    result = {
      text: t(bengali, "Happy to help! What are you shopping for today?", "অবশ্যই! আজ কী খুঁজছেন?"),
      parts:
        categories.length > 1
          ? [{ type: "refine_options", options: { query: "", facets: [{ name: "category", values: categories }] } }]
          : [],
    };
  } else if (/(order status|track|where is my order|my order|NB-[a-z0-9]{6}|অর্ডারের অবস্থা|অর্ডার কোথায়)/i.test(lower)) {
    result = await handleOrderStatus(session, text, bengali);
  } else if (/(checkout|check out|place (an )?order|buy now|চেকআউট|অর্ডার করুন)/.test(lower)) {
    if (cart.items.length === 0) {
      result = {
        text: t(
          bengali,
          "Your cart is empty. Add at least one product before checking out.",
          "কার্ট খালি। চেকআউটের আগে অন্তত একটি পণ্য যোগ করুন।",
        ),
        parts: [{ type: "cart_summary", cart }],
      };
    } else {
      result = {
        text: t(
          bengali,
          `Your cart total is ${formatPrice(cart.subtotalMinor, currency)} for ${cart.itemCount} item(s). Fill in your delivery details below and I'll take you to checkout to choose payment and place the order.`,
          `আপনার কার্টের মোট ${formatPrice(cart.subtotalMinor, currency)} (${cart.itemCount}টি পণ্য)। নিচে ডেলিভারির তথ্য দিন, তারপর চেকআউটে পেমেন্ট বেছে অর্ডার করুন।`,
        ),
        parts: [{ type: "cart_summary", cart }, { type: "details_form", prefill: {} }],
      };
    }
  } else if (/(remove|delete|সরাও|মুছ)/.test(lower)) {
    result = await handleRemove(session, text, bengali);
  } else if (/add\b|যোগ করুন|কার্টে/.test(lower)) {
    result = await handleAdd(session, text, bengali);
  } else if (/(cart|কার্ট)/.test(lower)) {
    if (cart.items.length === 0) {
      result = {
        text: t(
          bengali,
          "Your cart is empty. Ask me for a product and I will show some options.",
          "আপনার কার্ট খালি। কোন পণ্য চাই বলুন, আমি কিছু অপশন দেখাব।",
        ),
      };
    } else {
      result = {
        text: t(
          bengali,
          `Your cart has ${cart.itemCount} item(s) with a subtotal of ${formatPrice(cart.subtotalMinor, currency)}. You can change quantities in the cart panel.`,
          `আপনার কার্টে ${cart.itemCount}টি পণ্য আছে, সাবটোটাল ${formatPrice(cart.subtotalMinor, currency)}। কার্ট প্যানেল থেকে পরিমাণ বদলাতে পারেন।`,
        ),
        parts: [{ type: "cart_summary", cart }],
      };
    }
  } else {
    const policyQuery = detectPolicyTopic(text);
    if (policyQuery) {
      const hits = await searchKnowledge(session.storeId, policyQuery, 1);
      if (hits.length > 0) {
        const excerpt = hits[0].snippet.replace(/\s+/g, " ").slice(0, 480);
        result = {
          text: t(
            bengali,
            `${excerpt}\n\nSource: ${hits[0].title}.`,
            `${excerpt}\n\nসূত্র: ${hits[0].title}।`,
          ),
        };
      } else {
        result = {
          text: t(
            bengali,
            "I do not have an approved answer for that policy question. Please contact support@nokshibazaar.example.",
            "এই নীতিমালার প্রশ্নের অনুমোদিত উত্তর আমার কাছে নেই। support@nokshibazaar.example-এ যোগাযোগ করুন।",
          ),
          missed: true,
        };
      }
    } else {
      const maxPriceMinor = detectBudgetMinor(text);
      const category = detectCategory(text);
      const browsing = /(price list|all products|catalog|what do you sell|show me your products|দাম|সব পণ্য)/i.test(lower);
      const products = await searchProducts({
        storeId: session.storeId,
        text: browsing ? undefined : text,
        category,
        maxPriceMinor,
        limit: browsing ? 8 : 4,
      });

      if (products.length === 0) {
        result = {
          text: t(
            bengali,
            "I could not find a matching product in our current catalog. Try a different name, category, or budget.",
            "বর্তমান ক্যাটালগে মিলে যাওয়া পণ্য পাইনি। অন্য নাম, ক্যাটাগরি বা বাজেট দিয়ে দেখুন।",
          ),
          missed: true,
        };
      } else {
        const budgetText = maxPriceMinor
          ? t(bengali, ` under ${formatPrice(maxPriceMinor, currency)}`, ` ${formatPrice(maxPriceMinor, currency)}-এর নিচে`)
          : "";
        result = {
          text: t(
            bengali,
            `I found ${products.length} matching option(s)${budgetText}. Tap "Add" on a card to put one in your cart.`,
            `আমি ${products.length}টি মিলে যাওয়া অপশন পেয়েছি${budgetText}। কার্ডে "Add" চেপে কার্টে যোগ করতে পারেন।`,
          ),
          parts: [
            { type: "product_list", products },
            ...(computeFacets(products).length > 0
              ? [{ type: "refine_options" as const, options: { query: category ?? text, facets: computeFacets(products) } }]
              : []),
          ],
        };
      }
    }
  }

  yield* emitText(result.text);
  for (const part of result.parts ?? []) {
    yield { type: "ui", part };
  }

  const parts: ChatPart[] = [{ type: "text", text: result.text }, ...(result.parts ?? [])];
  yield { type: "done", content: result.text, parts, missed: result.missed };
}
