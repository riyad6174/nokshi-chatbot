// Loose, deterministic matching of configured terms ("Shirts", "green chili") against catalog text,
// so owner-written rules work without exact category names.

/** "Potatoes" -> "potato", "Chilies" -> "chili", "Shirts" -> "shirt". Short words are left alone. */
const IRREGULAR: Record<string, string> = { shoes: "shoe", canoes: "canoe", knives: "knife", leaves: "leaf", women: "woman", men: "man" };

export function singular(word: string): string {
  const lower = word.toLowerCase();
  if (IRREGULAR[lower]) return IRREGULAR[lower]!;
  if (lower.length <= 3) return lower;
  if (lower.endsWith("ies")) return `${lower.slice(0, -3)}y`;
  if (/(ch|sh|x|ss|o)es$/.test(lower) && lower.length > 4) return lower.slice(0, -2);
  if (lower.endsWith("s") && !lower.endsWith("ss") && !lower.endsWith("us")) return lower.slice(0, -1);
  return lower;
}

/** Lowercase word stems of a text (Latin and Bangla letters). */
export function stems(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1)
    .map(singular);
}

/**
 * Whether every word of `term` appears in `text` (singular/plural-insensitive). "green chili" matches
 * "Green Chilies 250g"; "chili" also matches "chilli" via a light spelling fold.
 */
export function termMatches(term: string, text: string): boolean {
  const wanted = stems(term).map(fold);
  if (wanted.length === 0) return false;
  const have = new Set(stems(text).map(fold));
  return wanted.every((word) => have.has(word));
}

/** Folds common spelling variants: doubled letters (chilli/chili), "ph"/"f", final y/i (chilies -> chily/chili). */
export function fold(word: string): string {
  return word.replace(/(.)\1+/g, "$1").replace(/ph/g, "f").replace(/y$/, "i");
}

export type MatchableProduct = {
  name: string;
  category: string;
  brand?: string;
  attributes: string | Record<string, string>;
};

function attributesText(attributes: MatchableProduct["attributes"]): string {
  if (typeof attributes === "string") {
    try {
      const parsed = JSON.parse(attributes) as Record<string, unknown>;
      return Object.values(parsed ?? {}).map(String).join(" ");
    } catch {
      return "";
    }
  }
  return Object.values(attributes).join(" ");
}

/** A configured term against a product's category, name (and optionally attributes). */
export function productMatchesTerm(product: MatchableProduct, term: string, includeAttributes = false): boolean {
  if (termMatches(term, product.category) || termMatches(term, product.name)) return true;
  return includeAttributes && termMatches(term, attributesText(product.attributes));
}

const COLOR_KEYS = ["color", "colour", "রং"];

/** Colours of a product from its attributes and variant options, lowercased. */
export function productColors(product: {
  name: string;
  attributes: Record<string, string>;
  variants?: Array<{ title: string; options: Record<string, string> }>;
}, known: string[] = []): string[] {
  const colors = new Set<string>();
  const add = (value: string | undefined) => {
    for (const part of (value ?? "").split(/[,/]/)) {
      const clean = part.trim().toLowerCase();
      if (clean) colors.add(clean);
    }
  };
  for (const [key, value] of Object.entries(product.attributes)) if (COLOR_KEYS.includes(key.toLowerCase())) add(value);
  for (const variant of product.variants ?? []) {
    for (const [key, value] of Object.entries(variant.options)) if (COLOR_KEYS.includes(key.toLowerCase())) add(value);
  }
  // Colour words in the name ("Beige Chinos"), limited to colours the store's pairing table knows.
  const nameWords = product.name.toLowerCase();
  for (const color of known) if (new RegExp(`\\b${color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(nameWords)) colors.add(color);
  return [...colors];
}
