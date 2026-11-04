// Demo store activity: ~90 days of shoppers, chats, orders, abandoned carts, handoffs, AI turn logs and
// marketing campaigns, so the admin dashboards (analytics, sales, marketing, inbox, orders, customers)
// have realistic data to show.
//
//   npm run db:seed          # catalog, settings and admin first (required)
//   npm run db:seed:demo     # this script; safe to re-run (replaces previous demo data)
//   npm run db:seed:demo -- --clear   # remove demo data only
//
// Everything this script creates is tied to visitor ids starting with "demo-" (and the campaign names
// below), so re-running or clearing never touches real shoppers' data. Dates are relative to "now".

import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

const PREFIX = "demo-";
const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.now();
const FREE_SHIPPING_OVER = 300000;
const ZONES = {
  dhaka: { label: "Inside Dhaka (2-3 days)", feeMinor: 8000 },
  outside: { label: "Outside Dhaka (3-5 days)", feeMinor: 15000 },
};
const CAMPAIGN_NAMES = {
  abandoned: "Abandoned cart reminder",
  eid: "Eid collection launch",
  winback: "Win-back: 10% off your next order",
  electronics: "Electronics accessories follow-up",
};

// ── Deterministic randomness (same data shape on every run) ────────────────────────────────────────
let seed = 20261104;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;
function weighted(entries) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rand() * total;
  for (const [value, weight] of entries) if ((roll -= weight) < 0) return value;
  return entries[entries.length - 1][0];
}

// ObjectIds whose timestamp matches the record's date, so ids sort like real data.
let oidCounter = Math.floor(Math.random() * 0xffffff);
function oid(date = new Date()) {
  const ts = Math.floor(date.getTime() / 1000).toString(16).padStart(8, "0");
  oidCounter = (oidCounter + 1) & 0xffffff;
  return ts + randomBytes(5).toString("hex") + oidCounter.toString(16).padStart(6, "0");
}

const ORDER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const usedOrderNumbers = new Set();
function orderNumber() {
  for (;;) {
    let code = "";
    for (let index = 0; index < 6; index += 1) code += ORDER_ALPHABET[Math.floor(rand() * ORDER_ALPHABET.length)];
    if (!usedOrderNumbers.has(code)) {
      usedOrderNumbers.add(code);
      return `NB-${code}`;
    }
  }
}

const bdt = (minor) => `BDT ${(minor / 100).toLocaleString("en-US")}`;
const firstSentence = (text) => (text.match(/^[^.]*\./)?.[0] ?? text).trim();

// ── People ─────────────────────────────────────────────────────────────────────────────────────────
const CUSTOMERS = [
  ["Tanvir Ahmed", "Dhaka", "House 12, Road 5, Dhanmondi"],
  ["Nusrat Jahan", "Dhaka", "Flat 4B, 22 Lake Circus, Kalabagan"],
  ["Rafiqul Islam", "Chattogram", "45 CDA Avenue, Nasirabad"],
  ["Farzana Akter", "Dhaka", "House 7, Sector 4, Uttara"],
  ["Mahmudul Hasan", "Sylhet", "Zindabazar Point, Flat 3A"],
  ["Sadia Rahman", "Dhaka", "Road 11, Block C, Banani"],
  ["Arif Chowdhury", "Chattogram", "18 Agrabad C/A"],
  ["Tasnim Sultana", "Rajshahi", "Upashahar, Sector 2, House 31"],
  ["Imran Hossain", "Dhaka", "Mirpur 10, Block D, Road 4, House 9"],
  ["Mim Chakraborty", "Khulna", "KDA Avenue, House 112"],
  ["Shakil Mahmud", "Dhaka", "Bashundhara R/A, Block G, Road 3"],
  ["Rumana Begum", "Cumilla", "Kandirpar, Holding 55"],
  ["Pritom Saha", "Dhaka", "Lalmatia, Block E, House 20"],
  ["Ayesha Siddiqua", "Dhaka", "Mohammadpur, Tajmahal Road, House 8"],
  ["Kamrul Hasan", "Barishal", "Sadar Road, Holding 210"],
  ["Jannatul Ferdous", "Dhaka", "Gulshan 2, Road 90, House 14"],
  ["Sabbir Rahman", "Gazipur", "Joydebpur, Chandana Chowrasta"],
  ["Nabila Islam", "Dhaka", "Baridhara DOHS, Road 6"],
  ["Anik Das", "Chattogram", "GEC Circle, Flat 7C"],
  ["Lamia Haque", "Sylhet", "Uposhohor, Block B"],
  ["Rakib Hasan", "Dhaka", "Shantinagar, 41 Siddheswari Road"],
  ["Tahmina Khatun", "Rangpur", "Dhap, Jail Road, House 16"],
  ["Mehedi Hasan", "Dhaka", "Wari, 9 Rankin Street"],
  ["Sumaiya Akter", "Narayanganj", "Chashara, Bangabandhu Road"],
  ["Fahim Karim", "Dhaka", "Niketan, Block C, Road 7"],
  ["Shirin Akhter", "Mymensingh", "Ganginarpar, House 3"],
  ["Ashik Iqbal", "Dhaka", "Malibagh Chowdhury Para, 12/A"],
  ["Riya Sarkar", "Bogura", "Sherpur Road, Holding 88"],
];
const ADMIN_FALLBACK = { id: null, name: "Support Team" };

// ── Script lines ───────────────────────────────────────────────────────────────────────────────────
const BN_CATEGORY = { Bags: "ব্যাগ", Clothing: "পোশাক", Electronics: "ইলেকট্রনিক্স", Home: "ঘর সাজানোর জিনিস", Accessories: "এক্সেসরিজ", Footwear: "জুতা" };

function searchLine(product, locale) {
  const cat = product.category.toLowerCase();
  if (locale === "bn") {
    return pick([
      { text: `${BN_CATEGORY[product.category] ?? product.category} দেখাতে পারবেন?`, query: product.category },
      { text: `${product.name} এর দাম কত?`, query: product.name },
    ]);
  }
  return pick([
    { text: `Do you have ${cat === "home" ? "home decor" : cat}?`, query: cat },
    { text: `Show me ${product.name.toLowerCase()}`, query: product.name.toLowerCase() },
    { text: `I'm looking for a gift under ${bdt(Math.ceil((product.priceMinor + 50000) / 100000) * 100000)}`, query: `gift under ${Math.ceil((product.priceMinor + 50000) / 100000) * 1000}` },
    { text: `What ${cat} do you have for daily use?`, query: cat },
    { text: `${product.name} price?`, query: product.name.toLowerCase() },
  ]);
}

function productReply(product, locale) {
  const inStock = product.variants.filter((variant) => variant.stockStatus === "in_stock").map((variant) => variant.title);
  if (locale === "bn") return `জি, ${product.name} আছে, দাম ${bdt(product.priceMinor)}। ${inStock.length ? `পাওয়া যাচ্ছে: ${inStock.join(", ")}।` : ""} কার্টে যোগ করে দেব?`;
  return `The ${product.name} by ${product.brand} is ${bdt(product.priceMinor)}. ${firstSentence(product.description)} ${inStock.length ? `In stock: ${inStock.join(", ")}.` : ""} Want me to add one to your cart?`.replace(/\s+/g, " ");
}

function detailLine(product) {
  const attrs = Object.entries(product.attrs);
  const [key, value] = pick(attrs);
  const label = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return {
    text: pick([`What's the ${label} of the ${product.name}?`, `Tell me more about the ${label}`, `${product.name} er ${label} ki?`]),
    reply: `The ${product.name}'s ${label} is ${value}. ${product.attrs.warranty ? `It comes with a ${product.attrs.warranty} warranty.` : ""}`.trim(),
  };
}

function knowledgeLine(city, locale) {
  const dhaka = city === "Dhaka";
  if (locale === "bn") {
    return pick([
      { text: "ডেলিভারি চার্জ কত?", query: "ডেলিভারি চার্জ", reply: "ঢাকার ভিতরে ডেলিভারি চার্জ ৮০ টাকা (২-৩ দিন), ঢাকার বাইরে ১৫০ টাকা (৩-৫ দিন)। ৩,০০০ টাকার বেশি অর্ডারে ডেলিভারি ফ্রি।" },
      { text: "বিকাশে পেমেন্ট করা যাবে?", query: "বিকাশ পেমেন্ট", reply: "জি, বিকাশ, নগদ, কার্ড এবং ক্যাশ অন ডেলিভারি সবই নেওয়া হয়। চ্যাটে কখনো পিন বা ওটিপি দেবেন না।" },
    ]);
  }
  return pick([
    {
      text: `How long does delivery take to ${city}?`,
      query: `delivery ${city.toLowerCase()}`,
      reply: dhaka
        ? "Inside Dhaka delivery takes 2-3 business days and costs BDT 80. Orders over BDT 3,000 ship free."
        : `Delivery to ${city} takes 3-5 business days and costs BDT 150. Orders over BDT 3,000 ship free anywhere in Bangladesh.`,
    },
    { text: "Can I return it if it doesn't fit?", query: "return policy", reply: "Yes, within 7 days of delivery if it's unused with tags attached. Size exchanges are free; just reply to your order SMS with the order number and a photo." },
    { text: "Do you accept bKash?", query: "bkash payment", reply: "Yes, we accept bKash, Nagad, Visa, Mastercard and cash on delivery (for orders up to BDT 10,000)." },
    { text: "Is cash on delivery available?", query: "cash on delivery", reply: "Yes, cash on delivery is available anywhere in Bangladesh for orders up to BDT 10,000." },
    { text: "What sizes do you have and how do they fit?", query: "size guide", reply: "Panjabi comes in M (40\" chest), L (42\") and XL (44\"); kurti in S, M and L. Between sizes? Pick the larger one for a relaxed fit. Size exchanges are free within 7 days." },
    { text: "Can you gift wrap it?", query: "gift wrap", reply: "Yes! Gift wrapping with a handwritten card is BDT 100 per item. Just mention it in the order notes, and we never put prices inside gift parcels." },
  ]);
}

const MISSING_PRODUCTS = ["gaming laptop", "iphone 16 case", "baby clothes", "perfume", "sunglasses", "ladies handbag leather", "kids school bag", "bluetooth speaker", "bedsheet", "wall clock", "perfume", "baby clothes", "sunglasses"];
const MISSING_KNOWLEDGE = [
  "Do you have a physical store I can visit?",
  "Can I pay with Rocket?",
  "Do you offer EMI on cards?",
  "Do you ship to India?",
  "Can I pay with Rocket?",
  "Do you have a physical store I can visit?",
  "Is there a student discount?",
];
const FALLBACK = "I could not find a verified answer for that. I can help with products in our catalog, delivery, returns, payments, and warranty, or connect you with support@nokshibazaar.example.";

// ── Builders ───────────────────────────────────────────────────────────────────────────────────────
const rows = {
  sessions: [],
  conversations: [],
  messages: [],
  turns: [],
  events: [],
  carts: [],
  cartItems: [],
  orders: [],
  profiles: [],
  campaigns: [],
  marketingMessages: [],
};

let store;
let catalog = [];
let admins = [];

function card(product) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    category: product.category,
    brand: product.brand,
    attributes: product.attrs,
    imageUrl: product.imageUrl,
    priceMinor: product.priceMinor,
    currency: product.currency,
    available: product.variants.some((variant) => variant.stockStatus === "in_stock"),
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      title: variant.title,
      options: JSON.parse(variant.options || "{}"),
      priceMinor: variant.priceOverrideMinor ?? product.priceMinor,
      stockStatus: variant.stockStatus,
      available: variant.stockStatus === "in_stock",
    })),
  };
}

function startVisit({ visitorId, profile, at, locale = "en", channel = "text", product = null }) {
  const session = { id: oid(at), storeId: store.id, visitorId, locale, createdAt: at, lastActivityAt: at };
  const conversation = {
    id: oid(at),
    storeId: store.id,
    sessionId: session.id,
    status: "bot",
    handoffReason: "",
    handoffAt: null,
    assignedAdminId: null,
    assignedName: "",
    missCount: 0,
    unreadForAdmin: 0,
    customerName: profile?.name ?? "",
    customerPhone: "",
    contextProductId: product?.id ?? null,
    lastMessageAt: at,
    createdAt: at,
    updatedAt: at,
  };
  rows.sessions.push(session);
  rows.conversations.push(conversation);
  if (profile && !profile.visitorIds.includes(visitorId)) profile.visitorIds.push(visitorId);
  return { session, conversation, profile, visitorId, locale, channel, t: at.getTime(), cart: null };
}

function message(visit, role, content, { parts, senderName = "", gapSeconds = [15, 80] } = {}) {
  visit.t += int(gapSeconds[0], gapSeconds[1]) * 1000;
  const at = new Date(visit.t);
  rows.messages.push({
    id: oid(at),
    conversationId: visit.conversation.id,
    role,
    content,
    structuredContent: parts ? JSON.stringify(parts) : null,
    attachments: [],
    senderName,
    createdAt: at,
  });
  visit.conversation.lastMessageAt = at;
  visit.conversation.updatedAt = at;
  visit.session.lastActivityAt = at;
  return at;
}

function event(visit, type, extra = {}) {
  const at = new Date(extra.at ?? visit.t);
  rows.events.push({
    id: oid(at),
    storeId: store.id,
    sessionId: visit.session.id,
    visitorId: visit.visitorId,
    profileId: visit.profile?.id ?? null,
    type,
    productId: extra.productId ?? null,
    cartId: extra.cartId ?? null,
    orderId: extra.orderId ?? null,
    valueMinor: extra.valueMinor ?? null,
    meta: JSON.stringify(extra.meta ?? {}),
    at,
  });
}

/** One customer message, the assistant's answer and the AI turn log. */
function turn(visit, userText, reply, { tools = [], outcome = "answered", intent = "browsing", parts } = {}) {
  const userAt = message(visit, "user", userText);
  const voice = visit.channel === "voice";
  const latencyMs = outcome === "error" ? int(9000, 20000) : int(voice ? 900 : 1300, voice ? 3200 : 5600);
  const toolCalls = tools.map((tool) => (typeof tool === "string" ? { name: tool, ok: true, code: "" } : { code: "", ...tool })).map((tool) => ({ ...tool, ms: int(40, 700) }));
  rows.turns.push({
    id: oid(userAt),
    storeId: store.id,
    conversationId: visit.conversation.id,
    sessionId: visit.session.id,
    channel: visit.channel,
    mode: "live",
    model: voice ? "gpt-realtime-2" : "gpt-4o-mini",
    outcome,
    latencyMs,
    firstTokenMs: outcome === "error" ? null : int(320, 1100),
    toolCalls,
    toolErrorCount: toolCalls.filter((tool) => !tool.ok).length,
    userText: userText.slice(0, 300),
    intent,
    at: userAt,
  });
  if (voice) event(visit, "voice_turn", { meta: { latencyMs } });
  if (outcome === "missed") visit.conversation.missCount += 1;
  visit.t += latencyMs;
  message(visit, "assistant", reply, { parts: parts ? [{ type: "text", text: reply }, ...parts] : undefined, gapSeconds: [0, 0] });
}

const inStockVariant = (product) => pick(product.variants.filter((variant) => variant.stockStatus === "in_stock"));
const others = (product, sameCategory = false) => catalog.filter((item) => item.id !== product.id && (!sameCategory || item.category === product.category));

function browse(visit, product, options = {}) {
  const line = searchLine(product, visit.locale);
  const shown = [product, ...(chance(0.4) ? [pick(others(product))] : [])];
  turn(visit, line.text, productReply(product, visit.locale), {
    tools: ["search_products"],
    intent: "browsing",
    parts: [{ type: "product_list", products: shown.map(card) }],
  });
  event(visit, "searched", { meta: { query: line.query.slice(0, 120), matched: true, count: shown.length, productIds: shown.map((item) => item.id) } });
  event(visit, "viewed_product", { productId: product.id });

  if (options.detail ?? chance(0.5)) {
    const detail = detailLine(product);
    turn(visit, detail.text, detail.reply, { tools: ["get_product_details"], intent: "interested" });
  }
  if (options.compare ?? chance(0.18)) {
    const alternatives = others(product, true);
    if (alternatives.length) {
      const other = pick(alternatives);
      const cheaper = other.priceMinor < product.priceMinor ? other : product;
      turn(
        visit,
        `Which is better, the ${product.name} or the ${other.name}?`,
        `Both are good picks. The ${cheaper.name} is the budget option at ${bdt(cheaper.priceMinor)}; the ${(cheaper === product ? other : product).name} costs more but ${firstSentence((cheaper === product ? other : product).description).toLowerCase()}`,
        {
          tools: ["compare_products"],
          intent: "comparing",
          parts: [{ type: "comparison", products: [card(product), card(other)], rows: [{ label: "Price", values: [bdt(product.priceMinor), bdt(other.priceMinor)] }, { label: "Brand", values: [product.brand, other.brand] }] }],
        },
      );
      event(visit, "compared", { meta: { productIds: [product.id, other.id] } });
      event(visit, "viewed_product", { productId: other.id });
    }
  }
  if (options.knowledge ?? chance(0.45)) {
    const qa = knowledgeLine(visit.profile?.city ?? pick(["Dhaka", "Chattogram", "Sylhet"]), visit.locale);
    turn(visit, qa.text, qa.reply, { tools: ["search_knowledge"], intent: "support" });
    event(visit, "searched", { meta: { scope: "knowledge", query: qa.query, matched: true, count: 1 } });
  }
  let recommended = [];
  if (options.recommend ?? chance(0.55)) {
    recommended = [...others(product)].sort(() => rand() - 0.5).slice(0, 2);
    event(visit, "recommendation_shown", { meta: { source: "get_recommendations", productIds: recommended.map((item) => item.id) } });
    if (chance(0.45)) {
      event(visit, "recommendation_clicked", { productId: recommended[0].id, meta: { productIds: [recommended[0].id] } });
      event(visit, "viewed_product", { productId: recommended[0].id });
    }
  }
  if (chance(0.2)) {
    event(visit, "proactive_shown", { productId: product.id, meta: { trigger: pick(["idle_on_product", "exit_intent", "returning_visitor"]), productIds: [product.id] } });
    if (chance(0.4)) event(visit, "proactive_dismissed", { meta: {} });
    else if (chance(0.08)) event(visit, "proactive_opt_out", { meta: {} });
  }
  return recommended;
}

function addToCart(visit, product, { quantity = 1, fromRecommendation = false } = {}) {
  const variant = inStockVariant(product);
  const at = new Date(visit.t);
  if (!visit.cart) {
    visit.cart = { id: oid(at), storeId: store.id, sessionId: visit.session.id, status: "active", currency: store.currency, createdAt: at, updatedAt: at, lines: [] };
    rows.carts.push(visit.cart);
  }
  const unit = variant.priceOverrideMinor ?? product.priceMinor;
  visit.cart.lines.push({ product, variant, quantity, unit });
  rows.cartItems.push({ id: oid(at), cartId: visit.cart.id, productId: product.id, productVariantId: variant.id, quantity, priceSnapshotMinor: unit, createdAt: at, updatedAt: at });
  const subtotal = visit.cart.lines.reduce((sum, line) => sum + line.unit * line.quantity, 0);
  const ask = visit.locale === "bn" ? `${variant.title} টা ${quantity} টা দিন` : quantity > 1 ? `Add ${quantity} of the ${variant.title} please` : pick([`I'll take the ${variant.title}`, `Add the ${variant.title} one to my cart`, `Ok add it, ${variant.title}`]);
  turn(
    visit,
    fromRecommendation ? `Add the ${product.name} too` : ask,
    `Added ${quantity} × ${product.name} (${variant.title}) to your cart. Subtotal: ${bdt(subtotal)}. ${subtotal >= FREE_SHIPPING_OVER ? "Your order qualifies for free delivery!" : `Add ${bdt(FREE_SHIPPING_OVER - subtotal)} more for free delivery.`}`,
    { tools: ["add_to_cart"], intent: "interested" },
  );
  event(visit, "added_to_cart", { productId: product.id, cartId: visit.cart.id, valueMinor: unit * quantity, meta: { variantId: variant.id, quantity, fromRecommendation } });
  visit.cart.updatedAt = new Date(visit.t);
}

function totals(cart, zoneId) {
  const subtotal = cart.lines.reduce((sum, line) => sum + line.unit * line.quantity, 0);
  const shipping = subtotal >= FREE_SHIPPING_OVER ? 0 : ZONES[zoneId].feeMinor;
  return { subtotal, shipping, total: subtotal + shipping };
}

function orderStatusFor(ageDays) {
  if (ageDays > 10) return weighted([["delivered", 86], ["cancelled", 7], ["refunded", 7]]);
  if (ageDays > 5) return weighted([["delivered", 75], ["shipped", 20], ["cancelled", 5]]);
  if (ageDays > 2) return weighted([["shipped", 50], ["processing", 30], ["delivered", 20]]);
  if (ageDays > 0.5) return weighted([["confirmed", 50], ["processing", 40], ["cancelled", 10]]);
  return weighted([["placed", 70], ["confirmed", 30]]);
}

function statusHistory(status, placedAt, adminName) {
  const at = (hours) => new Date(Math.min(placedAt.getTime() + hours * HOUR, NOW - 60_000));
  const history = [{ status: "placed", note: "", at: placedAt, by: "customer" }];
  if (status === "cancelled") {
    history.push({ status: "cancelled", note: pick(["Customer changed their mind", "Customer unreachable by phone", "Ordered the wrong size, placed a new order"]), at: at(int(2, 9)), by: adminName });
    return history;
  }
  const chain = ["confirmed", "processing", "shipped", "delivered"];
  const reach = status === "refunded" ? 4 : chain.indexOf(status) + 1;
  const offsets = [int(1, 4), int(14, 26), int(28, 44), int(70, 110)];
  for (let index = 0; index < reach; index += 1) {
    history.push({ status: chain[index], note: chain[index] === "shipped" ? "Handed to Steadfast courier" : "", at: at(offsets[index]), by: chain[index] === "delivered" ? "courier" : adminName });
  }
  if (status === "refunded") history.push({ status: "refunded", note: pick(["Returned: wrong size", "Returned: colour not as expected", "Defective, refunded to bKash"]), at: at(offsets[3] + int(72, 140)), by: adminName });
  return history;
}

function checkout(visit, profile, { confirm = true, payment = chance(0.7) ? "cod" : "online", recovered = false } = {}) {
  const zoneId = profile.city === "Dhaka" ? "dhaka" : "outside";
  const { subtotal, shipping, total } = totals(visit.cart, zoneId);
  const first = profile.name.split(" ")[0];
  const lines = visit.cart.lines.map((line) => `${line.quantity} × ${line.product.name} (${line.variant.title})`).join(", ");
  turn(
    visit,
    recovered
      ? "I came back from your SMS, please place my order with the same details"
      : `Please place the order. ${profile.name}, ${profile.phone}, ${profile.address}, ${profile.city}. ${payment === "cod" ? "Cash on delivery." : "I'll pay with bKash."}`,
    `Thanks ${first}! Here's your order: ${lines}. Delivery: ${shipping ? bdt(shipping) : "free"} (${ZONES[zoneId].label}). Total: ${bdt(total)}, ${payment === "cod" ? "cash on delivery" : "paid online"}. Shall I confirm it?`,
    { tools: ["save_customer_details", "propose_order"], intent: "ready_to_buy" },
  );
  event(visit, "checkout_started", { cartId: visit.cart.id, valueMinor: total });
  visit.conversation.customerName = profile.name;
  visit.conversation.customerPhone = profile.phone;
  if (!confirm) {
    turn(visit, pick(["Let me think about it", "I'll confirm later", "Wait, let me check with my family"]), "No problem! Your cart is saved. Just come back here when you're ready and I'll place the order.", { intent: "undecided" });
    return null;
  }

  const number = orderNumber();
  turn(
    visit,
    visit.locale === "bn" ? "হ্যাঁ, কনফার্ম করুন" : pick(["Yes, confirm", "Confirm please", "Yes go ahead"]),
    `Your order ${number} is placed! Total ${bdt(total)}. We'll SMS you a tracking link once the courier picks it up.`,
    { tools: ["confirm_order"], intent: "ready_to_buy" },
  );
  const placedAt = new Date(visit.t);
  const ageDays = (NOW - placedAt.getTime()) / DAY;
  const status = orderStatusFor(ageDays);
  const adminName = pick(admins).name;
  const history = statusHistory(status, placedAt, adminName);
  const order = {
    id: oid(placedAt),
    storeId: store.id,
    orderNumber: number,
    checkoutSessionId: null,
    sessionId: visit.session.id,
    conversationId: visit.conversation.id,
    customer: { name: profile.name, phone: profile.phone, email: profile.email, address: profile.address, city: profile.city, notes: chance(0.15) ? pick(["Please call before delivery", "Gift wrap please", "Deliver after 5 PM"]) : "" },
    items: visit.cart.lines.map((line) => ({
      productId: line.product.id,
      variantId: line.variant.id,
      name: line.product.name,
      variantTitle: line.variant.title,
      sku: line.variant.sku,
      quantity: line.quantity,
      unitPriceMinor: line.unit,
      lineTotalMinor: line.unit * line.quantity,
    })),
    subtotalMinor: subtotal,
    shippingMinor: shipping,
    totalMinor: total,
    currency: store.currency,
    shippingZone: zoneId,
    paymentMethod: payment,
    paymentStatus: status === "refunded" ? "refunded" : payment === "online" ? (status === "cancelled" ? "refunded" : "paid") : status === "delivered" ? "paid" : "pending",
    status,
    statusHistory: history,
    trackingNumber: history.some((entry) => entry.status === "shipped") ? `SF${int(10000000, 99999999)}` : "",
    createdAt: placedAt,
    updatedAt: history[history.length - 1].at,
  };
  rows.orders.push(order);
  message(visit, "event", `Order ${number} placed. Payment: ${payment === "cod" ? "cash on delivery" : "online"}.`, { gapSeconds: [1, 2] });
  event(visit, "order_placed", { orderId: order.id, cartId: visit.cart.id, valueMinor: total, meta: { orderNumber: number, productIds: visit.cart.lines.map((line) => line.product.id), recovered } });
  if (recovered) event(visit, "cart_recovered", { cartId: visit.cart.id, orderId: order.id, valueMinor: total });
  visit.cart.status = "checked_out";
  visit.cart.updatedAt = placedAt;

  if (status !== "cancelled") {
    profile.orderCount += 1;
    profile.totalSpentMinor += total;
  }
  profile.lastOrderAt = placedAt;
  profile.orders.push(order);
  return order;
}

/** state: "waiting" (no agent yet), "human" (agent replying), "closed"; random by age when omitted. */
function handoff(visit, profile, order, state) {
  const reasons = order
    ? [`My order ${order.orderNumber} still hasn't arrived, can I talk to a person?`, `I received the wrong colour in ${order.orderNumber}, I want to speak to someone`, `I need to change the address on ${order.orderNumber}, please connect me to support`]
    : ["Can I talk to a human?", "I want to speak with your manager about a bulk order"];
  const text = visit.locale === "bn" ? "আমি একজন মানুষের সাথে কথা বলতে চাই" : pick(reasons);
  turn(visit, text, "Sure, I'm connecting you with our team now.", { tools: ["request_human"], outcome: "handoff", intent: "support" });
  const handoffAt = message(visit, "event", "Connecting you with our team. Someone will reply here shortly.", {
    parts: [{ type: "text", text: "Connecting you with our team. Someone will reply here shortly." }, { type: "handoff", state: "waiting" }],
    gapSeconds: [1, 2],
  });
  Object.assign(visit.conversation, { status: "waiting_human", handoffAt, handoffReason: text, unreadForAdmin: 1 });

  const ageHours = (NOW - handoffAt.getTime()) / HOUR;
  if (state === "waiting" || (!state && ageHours < 30 && chance(0.6))) {
    // Still waiting in the inbox.
    if (chance(0.5)) {
      message(visit, "user", pick(["Hello? Anyone there?", "Please reply soon", "আছেন?"]), { gapSeconds: [120, 900] });
      visit.conversation.unreadForAdmin += 1;
    }
    return;
  }
  const agent = pick(admins);
  visit.t += int(3, 40) * 60_000;
  message(visit, "event", `${agent.name} joined the chat.`, { parts: [{ type: "text", text: `${agent.name} joined the chat.` }, { type: "handoff", state: "joined", agentName: agent.name }], gapSeconds: [0, 0] });
  message(
    visit,
    "agent",
    order
      ? pick([
          `Hi ${profile.name.split(" ")[0]}, I'm sorry about that. I checked with the courier: ${order.orderNumber} is with the delivery agent and will reach you tomorrow.`,
          `Sorry for the trouble! I've arranged a free exchange for ${order.orderNumber}. The courier will pick up the item and bring the right one in 2-3 days.`,
          `Done, I've updated the delivery address for ${order.orderNumber}. You'll get a fresh SMS from the courier.`,
        ])
      : "Hi! Happy to help. For orders of 20+ pieces we offer up to 12% off and custom packaging. What quantity do you need?",
    { senderName: agent.name, gapSeconds: [20, 60] },
  );
  message(visit, "user", pick(["Thank you so much!", "Ok great, thanks", "ধন্যবাদ!"]), { gapSeconds: [30, 240] });
  Object.assign(visit.conversation, { status: "human", assignedAdminId: agent.id, assignedName: agent.name, unreadForAdmin: 1 });
  if (state === "closed" || (!state && (ageHours > 20 || chance(0.5)))) {
    visit.conversation.unreadForAdmin = 0;
    message(visit, "agent", "You're welcome! Closing this chat now, message us any time.", { senderName: agent.name, gapSeconds: [20, 90] });
    message(visit, "event", "This conversation was closed. Send a message any time to start a new one.", {
      parts: [{ type: "text", text: "This conversation was closed. Send a message any time to start a new one." }, { type: "handoff", state: "closed" }],
      gapSeconds: [1, 5],
    });
    visit.conversation.status = "closed";
  }
}

function orderStatusCheck(visit, order) {
  const labels = { placed: "placed", confirmed: "confirmed", processing: "being packed", shipped: "on the way", delivered: "delivered", cancelled: "cancelled", refunded: "refunded" };
  turn(
    visit,
    pick([`Where is my order ${order.orderNumber}?`, `Status of ${order.orderNumber}?`, `${order.orderNumber} কবে পাব?`]),
    `Order ${order.orderNumber} is ${labels[order.status]}.${order.trackingNumber ? ` Tracking number: ${order.trackingNumber}.` : ""}${order.status === "shipped" ? " It should reach you within 1-2 days." : ""}`,
    { tools: ["get_order_status"], intent: "support" },
  );
}

function abandon(visit, { reminder }) {
  const cart = visit.cart;
  cart.status = "abandoned";
  const flaggedAt = new Date(cart.updatedAt.getTime() + int(60, 180) * 60_000);
  if (flaggedAt.getTime() > NOW) {
    cart.status = "active";
    return null;
  }
  const value = cart.lines.reduce((sum, line) => sum + line.unit * line.quantity, 0);
  event(visit, "abandoned_cart", { at: flaggedAt, cartId: cart.id, valueMinor: value, meta: { itemCount: cart.lines.length } });
  if (!reminder || !visit.profile) return { cart, flaggedAt, reminded: false };

  const profile = visit.profile;
  const sentAt = new Date(flaggedAt.getTime() + 60 * 60_000);
  if (sentAt.getTime() > NOW) return { cart, flaggedAt, reminded: false };
  const campaign = rows.campaigns.find((item) => item.name === CAMPAIGN_NAMES.abandoned);
  rows.marketingMessages.push({
    id: oid(sentAt),
    storeId: store.id,
    campaignId: campaign.id,
    profileId: profile.id,
    channel: "sms",
    recipient: profile.phone,
    status: "sent",
    reason: "",
    dedupeKey: cart.id,
    cartId: cart.id,
    subject: "",
    body: `Hi ${profile.name.split(" ")[0]}, you left ${cart.lines.map((line) => line.product.name).join(", ")} in your cart at Nokshi Bazaar. Complete your order: ${process.env.APP_BASE_URL || "http://localhost:3000"}/r/${cart.id.slice(-8)}\nReply STOP to unsubscribe.`,
    sentAt,
    clickedAt: null,
    createdAt: flaggedAt,
    _profile: profile,
  });
  event(visit, "marketing_sent", { at: sentAt, cartId: cart.id, meta: { campaignId: campaign.id, channel: "sms" } });
  return { cart, flaggedAt, sentAt, reminded: true, mm: rows.marketingMessages[rows.marketingMessages.length - 1] };
}

// ── Scenarios ──────────────────────────────────────────────────────────────────────────────────────
function shopperVisit(profile, at, kind) {
  const product = pick(catalog.filter((item) => item.variants.some((variant) => variant.stockStatus === "in_stock")));
  const visit = startVisit({ visitorId: profile.visitorId, profile, at, locale: profile.preferredLocale || "en", channel: chance(0.15) ? "voice" : "text", product });

  if (kind === "support") {
    const order = pick(profile.orders);
    orderStatusCheck(visit, order);
    if (chance(0.55)) handoff(visit, profile, order);
    return;
  }

  const recommended = browse(visit, product);
  if (kind === "browse") {
    if (chance(0.12)) handoff(visit, profile, null);
    return;
  }

  addToCart(visit, product, { quantity: chance(0.15) ? 2 : 1 });
  if (recommended.length && chance(0.35)) addToCart(visit, recommended[0], { fromRecommendation: true });

  if (kind === "buy") {
    checkout(visit, profile, { confirm: true });
    return;
  }

  // Abandoned: some leave mid-checkout, others right after adding to cart.
  if (chance(0.4)) checkout(visit, profile, { confirm: false });
  const consented = profile.marketingConsent?.granted && profile.marketingConsent.channels.includes("sms") && !profile.unsubscribedAt;
  const result = abandon(visit, { reminder: consented });
  if (!result?.reminded || !chance(0.5)) return;

  // Recovered from the reminder: the shopper clicks the SMS link and orders the same cart.
  const clickedAt = new Date(result.sentAt.getTime() + int(10, 600) * 60_000);
  if (clickedAt.getTime() > NOW - HOUR) return;
  result.mm.clickedAt = clickedAt;
  const back = startVisit({ visitorId: profile.visitorId, profile, at: clickedAt, locale: visit.locale, product });
  back.cart = result.cart;
  event(back, "marketing_clicked", { cartId: result.cart.id, meta: { campaignId: result.mm.campaignId } });
  checkout(back, profile, { confirm: true, recovered: true });
}

function anonymousVisit(index, at) {
  const kind = weighted([["browse", 45], ["missing_product", 22], ["missing_knowledge", 12], ["error", 5], ["abandon", 16]]);
  const product = pick(catalog.filter((item) => item.variants.some((variant) => variant.stockStatus === "in_stock")));
  const visit = startVisit({ visitorId: `${PREFIX}anon-${index}`, profile: null, at, locale: chance(0.25) ? "bn" : "en", channel: chance(0.12) ? "voice" : "text", product: kind === "browse" ? product : null });

  if (kind === "missing_product") {
    const query = pick(MISSING_PRODUCTS);
    turn(visit, pick([`Do you have ${query}?`, `${query}`, `I need ${query}`]), `Sorry, I couldn't find "${query}" in our catalog. We carry bags, clothing, footwear, electronics, home goods and accessories. Want me to suggest something close?`, {
      tools: ["search_products"],
      outcome: "missed",
      intent: "browsing",
    });
    event(visit, "searched", { meta: { query, matched: false, count: 0, productIds: [] } });
    if (chance(0.4)) browse(visit, product, { detail: false, compare: false, knowledge: false });
    return;
  }
  if (kind === "missing_knowledge") {
    const question = pick(MISSING_KNOWLEDGE);
    const answerable = question === "Do you ship to India?";
    turn(visit, question, answerable ? "Sorry, we currently ship only within Bangladesh." : FALLBACK, { tools: ["search_knowledge"], outcome: answerable ? "answered" : "missed", intent: "support" });
    event(visit, "searched", { meta: { scope: "knowledge", query: question.toLowerCase(), matched: answerable, count: answerable ? 1 : 0 } });
    return;
  }
  if (kind === "error") {
    turn(visit, searchLine(product, "en").text, "Sorry, something went wrong on my side. Please try again in a moment.", {
      tools: [{ name: "search_products", ok: false, code: pick(["timeout", "provider_error", "rate_limited"]) }],
      outcome: "error",
      intent: "browsing",
    });
    if (chance(0.6)) browse(visit, product, { detail: false, compare: false });
    return;
  }
  browse(visit, product);
  if (kind === "abandon") {
    addToCart(visit, product);
    abandon(visit, { reminder: false });
  }
}

// ── Clean-up ───────────────────────────────────────────────────────────────────────────────────────
async function clearDemo(storeId) {
  const sessions = await prisma.chatSession.findMany({ where: { storeId, visitorId: { startsWith: PREFIX } }, select: { id: true } });
  const sessionIds = sessions.map((session) => session.id);
  const conversations = await prisma.conversation.findMany({ where: { sessionId: { in: sessionIds } }, select: { id: true } });
  const conversationIds = conversations.map((conversation) => conversation.id);
  const carts = await prisma.cart.findMany({ where: { sessionId: { in: sessionIds } }, select: { id: true } });
  const cartIds = carts.map((cart) => cart.id);
  const profiles = (await prisma.customerProfile.findMany({ where: { storeId }, select: { id: true, visitorIds: true } })).filter((profile) =>
    profile.visitorIds.length > 0 && profile.visitorIds.every((visitor) => visitor.startsWith(PREFIX)),
  );
  const profileIds = profiles.map((profile) => profile.id);
  const campaigns = await prisma.marketingCampaign.findMany({ where: { storeId, name: { in: Object.values(CAMPAIGN_NAMES) } }, select: { id: true } });
  const campaignIds = campaigns.map((campaign) => campaign.id);

  const counts = {};
  counts.messages = (await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } })).count;
  counts.aiTurns = (await prisma.aiTurnLog.deleteMany({ where: { sessionId: { in: sessionIds } } })).count;
  counts.orders = (await prisma.order.deleteMany({ where: { storeId, sessionId: { in: sessionIds } } })).count;
  counts.checkouts = (await prisma.checkoutSession.deleteMany({ where: { cartId: { in: cartIds } } })).count;
  counts.cartItems = (await prisma.cartItem.deleteMany({ where: { cartId: { in: cartIds } } })).count;
  counts.carts = (await prisma.cart.deleteMany({ where: { id: { in: cartIds } } })).count;
  counts.events = (await prisma.customerEvent.deleteMany({ where: { storeId, visitorId: { startsWith: PREFIX } } })).count;
  counts.marketingMessages = (await prisma.marketingMessage.deleteMany({ where: { OR: [{ profileId: { in: profileIds } }, { campaignId: { in: campaignIds } }] } })).count;
  counts.campaigns = (await prisma.marketingCampaign.deleteMany({ where: { id: { in: campaignIds } } })).count;
  counts.profiles = (await prisma.customerProfile.deleteMany({ where: { id: { in: profileIds } } })).count;
  counts.conversations = (await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } })).count;
  counts.sessions = (await prisma.chatSession.deleteMany({ where: { id: { in: sessionIds } } })).count;
  return counts;
}

// ── Main ───────────────────────────────────────────────────────────────────────────────────────────
async function insert(label, model, data) {
  for (let index = 0; index < data.length; index += 500) await model.createMany({ data: data.slice(index, index + 500) });
  return `${data.length} ${label}`;
}

async function main() {
  const widgetKey = process.env.WIDGET_PUBLIC_KEY || "demo-widget-key";
  store = await prisma.store.findUnique({ where: { widgetKey } });
  if (!store) throw new Error(`No store with widget key "${widgetKey}". Run "npm run db:seed" first.`);

  const removed = await clearDemo(store.id);
  const removedTotal = Object.values(removed).reduce((sum, count) => sum + count, 0);
  if (removedTotal) console.log(`Removed previous demo data: ${Object.entries(removed).filter(([, count]) => count).map(([key, count]) => `${count} ${key}`).join(", ")}`);
  if (process.argv.includes("--clear")) return;

  const products = await prisma.product.findMany({ where: { storeId: store.id, status: "active" }, include: { variants: true } });
  catalog = products.map((product) => ({ ...product, attrs: JSON.parse(product.attributes || "{}") })).filter((product) => product.variants.length > 0);
  if (catalog.length < 3) throw new Error("The store needs at least 3 active products with variants. Run \"npm run db:seed\" first.");
  admins = (await prisma.adminUser.findMany({ select: { id: true, name: true } })).map((admin) => ({ id: admin.id, name: admin.name }));
  if (admins.length === 0) admins = [ADMIN_FALLBACK];

  // Campaigns first: abandoned-cart reminders reference the automation.
  const campaign = (name, data) => {
    const createdAt = data.launchedAt ?? new Date(NOW - int(1, 5) * DAY);
    const row = { id: oid(createdAt), storeId: store.id, name, segment: "{}", subject: "", delayMinutes: 60, launchedAt: null, createdAt, updatedAt: createdAt, ...data };
    rows.campaigns.push(row);
    return row;
  };
  campaign(CAMPAIGN_NAMES.abandoned, {
    kind: "abandoned_cart",
    channel: "sms",
    body: "Hi {name}, you left {products} in your cart at {store}. Complete your order: {link}",
    status: "active",
    launchedAt: new Date(NOW - 95 * DAY),
  });
  const eid = campaign(CAMPAIGN_NAMES.eid, {
    kind: "broadcast",
    channel: "sms",
    segment: JSON.stringify({ seenWithinDays: 60 }),
    body: "Eid Mubarak from {store}! New jamdani sarees, panjabis and kurtis just arrived, with free delivery over BDT 3,000. Shop now: {link}",
    status: "completed",
    launchedAt: new Date(NOW - 21 * DAY),
  });
  campaign(CAMPAIGN_NAMES.winback, {
    kind: "broadcast",
    channel: "email",
    segment: JSON.stringify({ minOrders: 1, inactiveForDays: 30 }),
    subject: "We miss you at Nokshi Bazaar: 10% off inside",
    body: "Hi {name},\n\nIt's been a while! Here's 10% off your next order with code COMEBACK10, valid for 7 days.\n\n{link}",
    status: "draft",
  });
  campaign(CAMPAIGN_NAMES.electronics, {
    kind: "product_followup",
    channel: "whatsapp",
    segment: JSON.stringify({ categoriesAny: ["Electronics"], maxOrders: 0 }),
    body: "Hi {name}, still thinking about {products}? Every SoundCraft and Horizon gadget comes with a warranty and free delivery over BDT 3,000. {link}",
    status: "paused",
    launchedAt: new Date(NOW - 12 * DAY),
  });

  // Customers with profiles.
  const profiles = CUSTOMERS.map(([name, city, address], index) => {
    const firstSeen = new Date(NOW - int(4, 88) * DAY - int(1, 12) * HOUR);
    const [first, last] = name.toLowerCase().split(" ");
    const phone = `01${pick(["3", "5", "6", "7", "8", "9"])}${String(int(10000000, 99999999))}`;
    const email = chance(0.55) ? `${first}.${last}@example.com` : "";
    const consented = chance(0.65);
    const channels = consented ? (email && chance(0.4) ? ["sms", "email"] : chance(0.3) ? ["sms", "whatsapp"] : ["sms"]) : [];
    const profile = {
      id: oid(firstSeen),
      visitorId: `${PREFIX}c${index + 1}`,
      name,
      phone,
      email,
      city,
      address,
      preferredLocale: chance(0.25) ? "bn" : "en",
      visitorIds: [],
      marketingConsent: consented
        ? {
            granted: true,
            channels,
            at: new Date(firstSeen.getTime() + 20 * 60_000),
            source: pick(["chat", "checkout", "voice"]),
            wording: "Can we send you offers and new arrivals? You can stop any time.",
            evidence: pick(["yes please", "sure", "ok", "হ্যাঁ", "yes, sms is fine"]),
          }
        : null,
      unsubscribedAt: null,
      orderCount: 0,
      totalSpentMinor: 0,
      lastOrderAt: null,
      orders: [],
      firstSeenAt: firstSeen,
    };
    // Plan visits between first seen and now.
    const visits = int(1, 4);
    const span = NOW - firstSeen.getTime() - 2 * HOUR;
    const times = Array.from({ length: visits }, (_, visitIndex) => firstSeen.getTime() + (visitIndex === 0 ? 0 : rand() * span)).sort((a, b) => a - b);
    for (const [visitIndex, time] of times.entries()) {
      const kind =
        visitIndex === 0
          ? weighted([["browse", 30], ["buy", 45], ["abandon", 25]])
          : weighted([["browse", 25], ["buy", 40], ["abandon", 15], ...(profile.orders.length ? [["support", 25]] : [])]);
      shopperVisit(profile, new Date(time), kind);
    }
    return profile;
  });
  // One shopper unsubscribed after the Eid broadcast.
  const unsubscribed = profiles.find((profile) => profile.marketingConsent?.granted);
  if (unsubscribed) {
    unsubscribed.unsubscribedAt = new Date(NOW - 18 * DAY);
    unsubscribed.marketingConsent.granted = false;
  }

  // Eid broadcast: one message per consented SMS shopper seen in the 60 days before launch.
  for (const profile of profiles) {
    if (!profile.marketingConsent?.channels.includes("sms") || profile.firstSeenAt >= eid.launchedAt) continue;
    const sentAt = new Date(eid.launchedAt.getTime() + int(1, 40) * 60_000);
    const skipped = profile === unsubscribed ? false : chance(0.06);
    rows.marketingMessages.push({
      id: oid(sentAt),
      storeId: store.id,
      campaignId: eid.id,
      profileId: profile.id,
      channel: "sms",
      recipient: profile.phone,
      status: skipped ? "failed" : "sent",
      reason: skipped ? "gateway_error" : "",
      dedupeKey: "launch",
      cartId: null,
      subject: "",
      body: `Eid Mubarak from Nokshi Bazaar! New jamdani sarees, panjabis and kurtis just arrived, with free delivery over BDT 3,000. Shop now: ${process.env.APP_BASE_URL || "http://localhost:3000"}\nReply STOP to unsubscribe.`,
      sentAt: skipped ? null : sentAt,
      clickedAt: !skipped && chance(0.3) ? new Date(sentAt.getTime() + int(5, 300) * 60_000) : null,
      createdAt: eid.launchedAt,
    });
  }

  // Fresh handoffs from the last few hours, so the inbox has work in every state.
  const withOrders = profiles.filter((profile) => profile.orders.length);
  ["waiting", "waiting", "human", "waiting", "human"].forEach((state, index) => {
    if (!withOrders.length) return;
    const profile = withOrders[(index * 5) % withOrders.length];
    const visit = startVisit({ visitorId: profile.visitorId, profile, at: new Date(NOW - (index * 3 + 1) * HOUR - int(5, 50) * 60_000), locale: profile.preferredLocale || "en" });
    const order = profile.orders[profile.orders.length - 1];
    orderStatusCheck(visit, order);
    handoff(visit, profile, order, state);
  });

  // Anonymous visitors, weighted towards recent days.
  for (let index = 0; index < 70; index += 1) {
    const daysAgo = 89 * Math.pow(rand(), 1.35);
    anonymousVisit(index + 1, new Date(NOW - daysAgo * DAY - int(1, 8) * HOUR));
  }

  // Finalize profiles from their sessions and orders.
  for (const profile of profiles) {
    const sessions = rows.sessions.filter((session) => profile.visitorIds.includes(session.visitorId));
    const lastSeen = sessions.reduce((max, session) => Math.max(max, session.lastActivityAt.getTime()), profile.firstSeenAt.getTime());
    const viewed = new Set(rows.events.filter((row) => row.profileId === profile.id && row.productId).map((row) => catalog.find((item) => item.id === row.productId)?.category).filter(Boolean));
    const lastOrder = profile.orders[profile.orders.length - 1];
    rows.profiles.push({
      id: profile.id,
      storeId: store.id,
      phoneKey: profile.phone.replace(/\D/g, "").slice(-10),
      phone: profile.phone,
      name: profile.name,
      email: profile.email,
      address: lastOrder ? profile.address : null,
      city: lastOrder ? profile.city : null,
      deliveryAreaId: lastOrder ? lastOrder.shippingZone : null,
      preferredLocale: profile.preferredLocale,
      interests: [...viewed].slice(0, 4),
      budgetHint: chance(0.3) ? pick(["under BDT 2,000", "under BDT 5,000", "around BDT 3,000"]) : "",
      visitorIds: profile.visitorIds,
      marketingConsent: profile.marketingConsent,
      unsubscribedAt: profile.unsubscribedAt,
      proactiveOptOut: rows.events.some((row) => row.profileId === profile.id && row.type === "proactive_opt_out") ? true : null,
      orderCount: profile.orderCount,
      totalSpentMinor: profile.totalSpentMinor,
      lastOrderAt: profile.lastOrderAt,
      firstSeenAt: profile.firstSeenAt,
      lastSeenAt: new Date(lastSeen),
      createdAt: profile.firstSeenAt,
      updatedAt: new Date(lastSeen),
    });
  }
  // Carts that are still open (recent visits) stay active.
  const carts = rows.carts.map(({ lines, ...cart }) => cart);
  const marketingMessages = rows.marketingMessages.map(({ _profile, ...row }) => row);

  const created = [];
  created.push(await insert("customers", prisma.customerProfile, rows.profiles));
  created.push(await insert("chat sessions", prisma.chatSession, rows.sessions));
  created.push(await insert("conversations", prisma.conversation, rows.conversations));
  created.push(await insert("messages", prisma.message, rows.messages));
  created.push(await insert("AI turn logs", prisma.aiTurnLog, rows.turns));
  created.push(await insert("carts", prisma.cart, carts));
  created.push(await insert("cart items", prisma.cartItem, rows.cartItems));
  created.push(await insert("orders", prisma.order, rows.orders));
  created.push(await insert("events", prisma.customerEvent, rows.events));
  created.push(await insert("campaigns", prisma.marketingCampaign, rows.campaigns));
  created.push(await insert("marketing messages", prisma.marketingMessage, marketingMessages));

  const revenue = rows.orders.filter((order) => order.status !== "cancelled").reduce((sum, order) => sum + order.totalMinor, 0);
  const waiting = rows.conversations.filter((conversation) => conversation.status === "waiting_human").length;
  console.log(`Seeded demo activity for "${store.name}": ${created.join(", ")}.`);
  console.log(`Orders: ${rows.orders.length} (${bdt(revenue)} excluding cancelled) · inbox waiting for an agent: ${waiting} · abandoned carts: ${carts.filter((cart) => cart.status === "abandoned").length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
