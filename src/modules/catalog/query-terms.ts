// Customers ask in Bangla (often via speech recognition); the catalog is in English. Common
// shopping words are mapped to the catalog's terms so "ঘড়ি" finds watches and "জামা" finds clothing.

// Spellings are NFC-normalized, like the query, since "য়" and "ড়" have two Unicode forms.
const BANGLA_TERMS: Array<[string[], string]> = [
  [["ব্যাকপ্যাক", "ব্যাক প্যাক"], "backpack"],
  [["ব্যাগ", "ব্যাক"], "bag"],
  [["টোট"], "tote"],
  [["জামা", "শার্ট", "কাপড়", "পোশাক"], "clothing"],
  [["পাঞ্জাবি", "পাঞ্জাবী"], "panjabi"],
  [["জুতা", "জুতো", "স্যান্ডেল"], "shoes"],
  [["ঘড়ি", "ওয়াচ"], "watch"],
  [["হেডফোন", "ইয়ারফোন", "ইয়ারবাড", "এয়ারবাড"], "earbuds"],
  [["চায়ের", "টি সেট", "চা সেট"], "tea"],
  [["স্কার্ফ", "ওড়না"], "scarf"],
  [["ইলেকট্রনিক্স", "গ্যাজেট"], "electronics"],
  [["গিফট", "উপহার"], "gift"],
  [["অ্যাক্সেসরিজ", "এক্সেসরিজ", "এক্সেসরিস"], "accessories"],
  [["কিচেন", "রান্নাঘর", "হোম"], "home"],
].map(([spellings, term]) => [(spellings as string[]).map((spelling) => spelling.normalize("NFC")), term as string]);

/** English catalog terms for a (partly) Bangla query, or "" when nothing is recognized. */
export function translateShoppingTerms(query: string): string {
  const text = query.normalize("NFC");
  const terms = BANGLA_TERMS.filter(([spellings]) => spellings.some((spelling) => text.includes(spelling))).map(([, term]) => term);
  return [...new Set(terms)].join(" ");
}
