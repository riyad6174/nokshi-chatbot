// Heuristic shopping-intent signals from the customer's latest message (English, Bangla and Bangla
// written in English letters). They guide the assistant's next move; the model still reads the
// message itself, so these are hints, never decisions.

export type ShoppingStage =
  | "browsing"
  | "interested"
  | "comparing"
  | "undecided"
  | "price_sensitive"
  | "ready_to_buy"
  | "support";

export type ShoppingIntent = {
  stage: ShoppingStage;
  signals: string[];
  /** The customer asked to stop suggestions / recommendations. */
  optOut: boolean;
  /** The customer explicitly asked for suggestions. */
  wantsSuggestions: boolean;
};

const test = (patterns: RegExp[], text: string) => patterns.some((pattern) => pattern.test(text));

const OPT_OUT = [
  /\b(stop|no more|quit|enough( with)?|don'?t|do not|no need for|without)\b[^.?!]{0,30}\b(suggest\w*|recommend\w*|upsell\w*|offers?|add-?ons?|pop-?ups?|extras?)/i,
  /\bjust (looking|browsing)\b.*\b(thanks|please)\b/i,
  /\bleave me alone\b/i,
  /(আর|কোন|কোনো)?\s*(সাজেস্ট|সাজেশন|রেকমেন্ড|পরামর্শ)[^।?!]{0,20}(করবেন না|করো না|দরকার নেই|লাগবে না|চাই না|বন্ধ)/u,
  /\b(r|ar|aar)?\s*(suggest|suggestion|recommend)\w*\s*(korben na|koro na|lagbe na|dorkar nai|dorkar nei|chai na)\b/i,
];

const WANTS_SUGGESTIONS = [
  /\b(suggest|recommend|what (goes|would go) (well )?with|what else|anything else (to|that)|match(es|ing)?|complete the look|pair (it )?with)\b/i,
  /(সাজেস্ট|রেকমেন্ড|সাথে কি|সাথে কী|মিলিয়ে|ম্যাচিং)/u,
  /\b(sathe ki|matching|milie)\b/i,
];

const READY = [
  /\b(buy (it|this|now)|i'?ll take|i want (to order|it|this one)|place (the|my|an)? ?order|order (it|this|now)|checkout|check out|add (it|this) to (my )?cart|confirm)\b/i,
  /(অর্ডার|কিনব|নেব|নিবো|নিব|কনফার্ম|কার্টে)/u,
  /\b(order korbo|kinbo|nibo|nebo|confirm koren)\b/i,
];

const PRICE = [
  /\b(cheap(er|est)?|expensive|too (much|costly|pricey)|budget|afford|discount|lower price|less than|under \d|within \d|price)\b/i,
  /(দাম বেশি|কম দাম|সস্তা|বাজেট|ডিসকাউন্ট|ছাড়|এর মধ্যে|টাকার মধ্যে)/u,
  /\b(dam beshi|kom dam|sosta|sasta|budget)\b/i,
];

const COMPARE = [
  /\b(compare|comparison|vs\.?|versus|difference|which (one )?is better|better than)\b/i,
  /(তুলনা|পার্থক্য|কোনটা ভালো|কোনটি ভালো)/u,
  /\b(konta valo|konta bhalo|parthokko)\b/i,
];

const UNDECIDED = [
  /\b(not sure|unsure|maybe|confused|can'?t decide|thinking about|let me think|hmm+|don'?t know)\b/i,
  /(বুঝতে পারছি না|ভাবছি|জানি না|দ্বিধা)/u,
  /\b(bujhte parchi na|vabchi|bhabchi|jani na)\b/i,
];

const SUPPORT = [
  /\b(order status|track(ing)?|where is my order|refund|return|complain\w*|cancel|broken|damaged|wrong item)\b/i,
  /(অর্ডার কোথায়|ট্র্যাক|রিফান্ড|রিটার্ন|ফেরত|অভিযোগ|বাতিল)/u,
];

const INTERESTED = [
  /\b(i need|i want|looking for|show me|do you have|i'?m after|need some|want some)\b/i,
  /(লাগবে|চাই|দেখান|আছে কি|খুঁজছি)/u,
  /\b(lagbe|chai|dekhan|ache ki)\b/i,
];

export function detectShoppingIntent(input: { text: string; cartItemCount: number; openOrder?: boolean }): ShoppingIntent {
  const text = input.text.normalize("NFC");
  const optOut = test(OPT_OUT, text);
  const wantsSuggestions = !optOut && test(WANTS_SUGGESTIONS, text);
  const signals: string[] = [];
  let stage: ShoppingStage = input.cartItemCount > 0 ? "interested" : "browsing";

  if (test(SUPPORT, text)) {
    stage = "support";
    signals.push("support request");
  } else if (input.openOrder || test(READY, text)) {
    stage = "ready_to_buy";
    signals.push(input.openOrder ? "order summary on screen" : "buying words");
  } else if (test(COMPARE, text)) {
    stage = "comparing";
    signals.push("comparing options");
  } else if (test(PRICE, text)) {
    stage = "price_sensitive";
    signals.push("price or budget concern");
  } else if (test(UNDECIDED, text)) {
    stage = "undecided";
    signals.push("unsure");
  } else if (test(INTERESTED, text)) {
    stage = "interested";
    signals.push("stated a need");
  }
  if (optOut) signals.push("asked for no more suggestions");
  if (wantsSuggestions) signals.push("asked for suggestions");
  return { stage, signals, optOut, wantsSuggestions };
}

export const STAGE_GUIDANCE: Record<ShoppingStage, string> = {
  browsing: "Help them discover: one question about what they need, or show a few good options.",
  interested: "They want something specific: show the best 1-2 matches and why they fit.",
  comparing: "Compare clearly (compare_products), give a recommendation with one reason, then let them choose.",
  undecided: "Reassure with one concrete fact from the catalog, narrow to one pick, ask one easy question.",
  price_sensitive: "Respect the budget: offer get_recommendations kind 'cheaper' or search within their limit. No pressure.",
  ready_to_buy: "Don't sell more: complete the order quickly (cart, details, summary).",
  support: "Solve the support request first; no selling in this reply.",
};
