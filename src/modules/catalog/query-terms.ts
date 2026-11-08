// Customers ask in Bangla (often via speech recognition), in Bangla written with English letters
// ("aloo", "juta"), or with everyday synonyms; the catalog is in English. Common shopping words are
// mapped to the catalog's terms so "ঘড়ি" finds watches, "আলু"/"aloo" finds potatoes and "sneakers"
// finds shoes. Stores add their own synonyms in Admin → AI Sales & Engagement.

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
  // Groceries
  [["আলু"], "potato"],
  [["পেঁয়াজ", "পিঁয়াজ", "পেয়াজ", "পিয়াজ"], "onion"],
  [["মরিচ", "লঙ্কা"], "chili"],
  [["রসুন"], "garlic"],
  [["আদা"], "ginger"],
  [["হলুদ"], "turmeric"],
  [["টমেটো"], "tomato"],
  [["শসা"], "cucumber"],
  [["ডিম"], "egg"],
  [["চাল"], "rice"],
  [["ডাল"], "lentil"],
  [["মুরগি", "মুরগী"], "chicken"],
  [["মাছ"], "fish"],
  [["মাংস", "গোশত"], "meat"],
  [["তেল"], "oil"],
  [["লবণ", "নুন"], "salt"],
  [["চিনি"], "sugar"],
  [["দুধ"], "milk"],
  [["পাউরুটি", "রুটি"], "bread"],
  // Electronics and fashion
  [["মোবাইল", "ফোন"], "phone"],
  [["চার্জার"], "charger"],
  [["কভার", "কেস"], "case"],
  [["ল্যাপটপ"], "laptop"],
  [["প্যান্ট"], "pants"],
  [["শাড়ি", "শাড়ী"], "saree"],
  [["বেল্ট"], "belt"],
].map(([spellings, term]) => [(spellings as string[]).map((spelling) => spelling.normalize("NFC")), term as string]);

// Bangla written in English letters, and common English synonyms. Matched as whole words.
const LATIN_TERMS: Record<string, string> = {
  aloo: "potato",
  alu: "potato",
  piyaj: "onion",
  peyaj: "onion",
  piaj: "onion",
  morich: "chili",
  roshun: "garlic",
  rosun: "garlic",
  ada: "ginger",
  holud: "turmeric",
  dim: "egg",
  deem: "egg",
  chal: "rice",
  chaal: "rice",
  daal: "lentil",
  dal: "lentil",
  murgi: "chicken",
  mach: "fish",
  maach: "fish",
  mangsho: "meat",
  gosht: "meat",
  tel: "oil",
  lobon: "salt",
  chini: "sugar",
  dudh: "milk",
  jama: "clothing",
  kapor: "clothing",
  juta: "shoes",
  jutha: "shoes",
  ghori: "watch",
  ghodi: "watch",
  shari: "saree",
  sharee: "saree",
  sari: "saree",
  panjabee: "panjabi",
  punjabi: "panjabi",
  mobile: "phone",
  cellphone: "phone",
  smartphone: "phone",
  sneakers: "shoes",
  sneaker: "shoes",
  trainers: "shoes",
  footwear: "shoes",
  trousers: "pants",
  chinos: "pants",
  tee: "t-shirt",
  tshirt: "t-shirt",
  earphones: "earbuds",
  headphones: "earbuds",
  rucksack: "backpack",
  handbag: "bag",
  purse: "bag",
  cover: "case",
  adapter: "charger",
};

function latinWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
}

/**
 * English catalog terms for a query in Bangla, Banglish or with synonyms, or "" when nothing is
 * recognized. `storeSynonyms` (from the store's sales configuration) are matched as whole words or
 * phrases, e.g. {"aloo": ["potato"], "gift box": ["hamper"]}.
 */
export function translateShoppingTerms(query: string, storeSynonyms: Record<string, string[]> = {}): string {
  const text = query.normalize("NFC");
  const lower = text.toLowerCase();
  const terms = BANGLA_TERMS.filter(([spellings]) => spellings.some((spelling) => text.includes(spelling))).map(([, term]) => term);
  for (const word of latinWords(text)) {
    const term = LATIN_TERMS[word];
    if (term) terms.push(term);
  }
  for (const [phrase, targets] of Object.entries(storeSynonyms)) {
    const key = phrase.trim().toLowerCase();
    if (!key) continue;
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u");
    if (pattern.test(lower)) terms.push(...targets.map((target) => target.trim().toLowerCase()).filter(Boolean));
  }
  return [...new Set(terms)].join(" ");
}
