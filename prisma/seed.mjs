import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function hashContent(content) {
  return createHash("sha256").update(content).digest("hex");
}

const products = [
  {
    externalProductId: "ext_utb_001",
    slug: "urban-trek-backpack",
    brand: "Trekline",
    name: "Urban Trek Backpack",
    category: "Bags",
    priceMinor: 250000,
    imageUrl: "/products/backpack.svg",
    description:
      "A water-resistant 24L daypack with a padded laptop sleeve, breathable back panel, and two bottle pockets. Good for commuting, university, and short trips. ঢাকার দৈনন্দিন যাতায়াত ও একদিনের ভ্রমণের জন্য উপযুক্ত ২৪ লিটার ব্যাকপ্যাক।",
    attributes: {
      material: "600D recycled polyester",
      capacity: "24L",
      laptop: "Up to 15 inches",
      waterproof: "Water resistant",
    },
    variants: [
      { sku: "UTB-BLK", title: "Black", options: { color: "Black" }, externalVariantId: "gid_utb_blk", stockQuantity: 14 },
      { sku: "UTB-OLV", title: "Olive", options: { color: "Olive" }, externalVariantId: "gid_utb_olv", stockQuantity: 6 },
    ],
  },
  {
    externalProductId: "ext_ect_002",
    slug: "everyday-canvas-tote",
    brand: "Nokshi Basics",
    name: "Everyday Canvas Tote",
    category: "Bags",
    priceMinor: 120000,
    imageUrl: "/products/tote.svg",
    description:
      "A sturdy 16oz cotton canvas tote with an inner zip pocket and reinforced handles. Fits a 14-inch laptop, books, and groceries. মজবুত ক্যানভাসের টোট ব্যাগ, ভেতরে জিপ পকেটসহ।",
    attributes: { material: "16oz cotton canvas", capacity: "18L", care: "Hand wash cold" },
    variants: [
      { sku: "ECT-NAT", title: "Natural", options: { color: "Natural" }, externalVariantId: "gid_ect_nat", stockQuantity: 25 },
      { sku: "ECT-BLK", title: "Black", options: { color: "Black" }, externalVariantId: "gid_ect_blk", stockQuantity: 11 },
    ],
  },
  {
    externalProductId: "ext_wep_003",
    slug: "wireless-earbuds-pro",
    brand: "SoundCraft",
    name: "Wireless Earbuds Pro",
    category: "Electronics",
    priceMinor: 320000,
    imageUrl: "/products/earbuds.svg",
    description:
      "Bluetooth 5.3 earbuds with active noise cancellation, 6 hours playback per charge, and a USB-C charging case. Includes a 6-month warranty. অ্যাক্টিভ নয়েজ ক্যানসেলিংসহ ব্লুটুথ ইয়ারবাড, ৬ মাসের ওয়ারেন্টি।",
    attributes: {
      battery: "6 hours + 18 hours with case",
      bluetooth: "5.3",
      noiseCancellation: "Active",
      warranty: "6 months",
    },
    variants: [
      { sku: "WEP-BLK", title: "Graphite", options: { color: "Graphite" }, externalVariantId: "gid_wep_blk", stockQuantity: 9 },
      { sku: "WEP-WHT", title: "Ivory", options: { color: "Ivory" }, externalVariantId: "gid_wep_wht", stockQuantity: 4 },
    ],
  },
  {
    externalProductId: "ext_cpj_004",
    slug: "cotton-panjabi",
    brand: "Nokshi Heritage",
    name: "Cotton Panjabi",
    category: "Clothing",
    priceMinor: 280000,
    imageUrl: "/products/panjabi.svg",
    description:
      "A breathable 100% cotton panjabi with a mandarin collar and subtle embroidery at the placket. Machine washable. আরামদায়ক সুতির পাঞ্জাবি, মেশিনে ধোয়া যায়।",
    attributes: {
      fabric: "100% cotton",
      fit: "Regular",
      care: "Machine wash cold, do not bleach",
      sizes: "M, L, XL",
    },
    variants: [
      { sku: "CPJ-M", title: "Medium", options: { size: "M" }, externalVariantId: "gid_cpj_m", stockQuantity: 8 },
      { sku: "CPJ-L", title: "Large", options: { size: "L" }, externalVariantId: "gid_cpj_l", stockQuantity: 12 },
      { sku: "CPJ-XL", title: "Extra Large", options: { size: "XL" }, externalVariantId: "gid_cpj_xl", stockQuantity: 0, stockStatus: "out_of_stock" },
    ],
  },
  {
    externalProductId: "ext_cts_005",
    slug: "ceramic-tea-set",
    brand: "Mati Home",
    name: "Ceramic Tea Set",
    category: "Home",
    priceMinor: 185000,
    imageUrl: "/products/teaset.svg",
    description:
      "A six-cup glazed ceramic tea set with a matching teapot and tray. Dishwasher safe. Six cups, one teapot, and a tray. ছয় কাপের সিরামিক টি সেট, টিপট ও ট্রিসহ।",
    attributes: { pieces: "8", material: "Glazed ceramic", care: "Dishwasher safe" },
    variants: [
      { sku: "CTS-6PCS", title: "Sage green, 6 cups", options: { color: "Sage green", pieces: "6" }, externalVariantId: "gid_cts_sage", stockQuantity: 5 },
    ],
  },
  {
    externalProductId: "ext_hnc_006",
    slug: "handloom-scarf",
    brand: "Tangail Weaves",
    name: "Handloom Scarf",
    category: "Accessories",
    priceMinor: 95000,
    imageUrl: "/products/scarf.svg",
    description:
      "A lightweight handwoven cotton scarf with a traditional jamdani-inspired border. Made by weavers in Tangail and finished with hand-rolled edges. টাঙ্গাইলের তাঁতিদের হাতে বোনা সুতি স্কার্ফ।",
    attributes: { fabric: "Handwoven cotton", origin: "Tangail, Bangladesh", care: "Hand wash separately" },
    variants: [
      { sku: "HLS-RED", title: "Lac red", options: { color: "Lac red" }, externalVariantId: "gid_hls_red", stockQuantity: 17 },
      { sku: "HLS-IND", title: "Indigo", options: { color: "Indigo" }, externalVariantId: "gid_hls_ind", stockQuantity: 2 },
    ],
  },
  {
    externalProductId: "ext_mww_007",
    slug: "minimalist-wrist-watch",
    brand: "Horizon",
    name: "Minimalist Wrist Watch",
    category: "Accessories",
    priceMinor: 450000,
    imageUrl: "/products/watch.svg",
    description:
      "A 38mm stainless steel watch with a Japanese quartz movement, sapphire-coated glass, and a quick-release leather strap. Water resistant to 3 ATM. জাপানি কোয়ার্টজ মুভমেন্ট ও লেদার স্ট্র্যাপের ঘড়ি।",
    attributes: { case: "38mm stainless steel", movement: "Japanese quartz", waterResistance: "3 ATM", warranty: "1 year" },
    variants: [
      { sku: "MWW-SLV", title: "Silver / Tan leather", options: { case: "Silver", strap: "Tan leather" }, externalVariantId: "gid_mww_slv", stockQuantity: 3 },
      { sku: "MWW-BLK", title: "Black / Black leather", options: { case: "Black", strap: "Black leather" }, externalVariantId: "gid_mww_blk", stockQuantity: 0, stockStatus: "out_of_stock" },
    ],
  },
  {
    externalProductId: "ext_jms_008",
    slug: "jamdani-saree",
    brand: "Tangail Weaves",
    name: "Jamdani Saree",
    category: "Clothing",
    priceMinor: 650000,
    imageUrl: "/products/saree.svg",
    description:
      "A handwoven half-silk jamdani saree with a zari-touched border and a 6-yard drape, plus an unstitched blouse piece. Ideal for weddings and Eid. হাতে বোনা হাফসিল্ক জামদানি শাড়ি, ব্লাউজ পিসসহ।",
    attributes: { fabric: "Half silk", length: "6 yards + blouse piece", origin: "Narayanganj, Bangladesh", care: "Dry clean only" },
    variants: [
      { sku: "JMS-RED", title: "Crimson / Gold", options: { color: "Crimson" }, externalVariantId: "gid_jms_red", stockQuantity: 4 },
      { sku: "JMS-TEA", title: "Teal / Silver", options: { color: "Teal" }, externalVariantId: "gid_jms_tea", stockQuantity: 2 },
    ],
  },
  {
    externalProductId: "ext_nkc_009",
    slug: "nakshi-kantha-cushion-cover",
    brand: "Mati Home",
    name: "Nakshi Kantha Cushion Cover (Set of 2)",
    category: "Home",
    priceMinor: 85000,
    imageUrl: "/products/cushion.svg",
    description:
      "Two 16x16 inch cotton cushion covers with hand-stitched nakshi kantha embroidery and a hidden zip. Inserts not included. হাতে সেলাই করা নকশি কাঁথার কুশন কভার, দুইটির সেট।",
    attributes: { size: "16 x 16 inches", fabric: "Cotton", pieces: "2", care: "Hand wash cold, dry in shade" },
    variants: [
      { sku: "NKC-RED", title: "Red on cream", options: { color: "Red on cream" }, externalVariantId: "gid_nkc_red", stockQuantity: 20 },
      { sku: "NKC-BLU", title: "Blue on cream", options: { color: "Blue on cream" }, externalVariantId: "gid_nkc_blu", stockQuantity: 13 },
    ],
  },
  {
    externalProductId: "ext_jmb_010",
    slug: "jute-market-bag",
    brand: "Nokshi Basics",
    name: "Jute Market Bag",
    category: "Bags",
    priceMinor: 65000,
    imageUrl: "/products/jute.svg",
    description:
      "A plastic-free jute shopping bag with cotton-lined handles that carries up to 10 kg. Folds flat. প্লাস্টিকমুক্ত পাটের বাজারের ব্যাগ, ১০ কেজি পর্যন্ত বহন করে।",
    attributes: { material: "Natural jute", capacity: "Up to 10 kg", care: "Spot clean only" },
    variants: [{ sku: "JMB-NAT", title: "Natural", options: { color: "Natural" }, externalVariantId: "gid_jmb_nat", stockQuantity: 40 }],
  },
  {
    externalProductId: "ext_lsd_011",
    slug: "leather-sandals",
    brand: "Chorui Footwear",
    name: "Leather Sandals",
    category: "Footwear",
    priceMinor: 220000,
    imageUrl: "/products/sandals.svg",
    description:
      "Handcrafted cow-leather sandals with a cushioned footbed and an anti-slip rubber sole. Pairs well with panjabi or casual wear. আরামদায়ক চামড়ার স্যান্ডেল, পাঞ্জাবির সাথে মানানসই।",
    attributes: { material: "Genuine cow leather", sole: "Anti-slip rubber", sizes: "40-44" },
    variants: [
      { sku: "LSD-40", title: "Size 40", options: { size: "40" }, externalVariantId: "gid_lsd_40", stockQuantity: 5 },
      { sku: "LSD-41", title: "Size 41", options: { size: "41" }, externalVariantId: "gid_lsd_41", stockQuantity: 9 },
      { sku: "LSD-42", title: "Size 42", options: { size: "42" }, externalVariantId: "gid_lsd_42", stockQuantity: 7 },
      { sku: "LSD-43", title: "Size 43", options: { size: "43" }, externalVariantId: "gid_lsd_43", stockQuantity: 3 },
      { sku: "LSD-44", title: "Size 44", options: { size: "44" }, externalVariantId: "gid_lsd_44", stockQuantity: 0, stockStatus: "out_of_stock" },
    ],
  },
  {
    externalProductId: "ext_pwb_012",
    slug: "power-bank-20000mah",
    brand: "SoundCraft",
    name: "Power Bank 20000mAh",
    category: "Electronics",
    priceMinor: 280000,
    imageUrl: "/products/powerbank.svg",
    description:
      "A 20000mAh power bank with 22.5W fast charging, USB-C in/out, and two USB-A ports. Charges a phone about 4 times. Includes a 6-month warranty. ২০০০০ এমএএইচ ফাস্ট চার্জিং পাওয়ার ব্যাংক।",
    attributes: { capacity: "20000mAh", output: "22.5W fast charge", ports: "1x USB-C, 2x USB-A", warranty: "6 months" },
    variants: [
      { sku: "PWB-BLK", title: "Black", options: { color: "Black" }, externalVariantId: "gid_pwb_blk", stockQuantity: 18 },
      { sku: "PWB-WHT", title: "White", options: { color: "White" }, externalVariantId: "gid_pwb_wht", stockQuantity: 7 },
    ],
  },
  {
    externalProductId: "ext_sfb_013",
    slug: "smart-fitness-band",
    brand: "Horizon",
    name: "Smart Fitness Band",
    category: "Electronics",
    priceMinor: 350000,
    imageUrl: "/products/fitnessband.svg",
    description:
      "A fitness band with an AMOLED display, heart-rate and SpO2 tracking, sleep tracking, call and message alerts, and up to 10 days of battery. Works with Android and iPhone. হার্ট রেট ও ঘুম ট্র্যাক করার স্মার্ট ব্যান্ড, ১০ দিন ব্যাটারি।",
    attributes: { display: "1.1 inch AMOLED", battery: "Up to 10 days", waterResistance: "5 ATM", warranty: "1 year" },
    variants: [
      { sku: "SFB-BLK", title: "Midnight", options: { color: "Midnight" }, externalVariantId: "gid_sfb_blk", stockQuantity: 11 },
      { sku: "SFB-PNK", title: "Rose", options: { color: "Rose" }, externalVariantId: "gid_sfb_pnk", stockQuantity: 6 },
    ],
  },
  {
    externalProductId: "ext_ckt_014",
    slug: "cotton-kurti",
    brand: "Nokshi Heritage",
    name: "Cotton Kurti",
    category: "Clothing",
    priceMinor: 190000,
    imageUrl: "/products/kurti.svg",
    description:
      "A block-printed cotton kurti with three-quarter sleeves and side slits, made for everyday comfort in the heat. Machine washable. হাতে ব্লক প্রিন্ট করা সুতির কুর্তি।",
    attributes: { fabric: "100% cotton", fit: "Straight", length: "44 inches", care: "Machine wash cold inside out", sizes: "S, M, L" },
    variants: [
      { sku: "CKT-S", title: "Small", options: { size: "S" }, externalVariantId: "gid_ckt_s", stockQuantity: 10 },
      { sku: "CKT-M", title: "Medium", options: { size: "M" }, externalVariantId: "gid_ckt_m", stockQuantity: 15 },
      { sku: "CKT-L", title: "Large", options: { size: "L" }, externalVariantId: "gid_ckt_l", stockQuantity: 8 },
    ],
  },
  {
    externalProductId: "ext_ttp_015",
    slug: "terracotta-planter",
    brand: "Mati Home",
    name: "Terracotta Planter",
    category: "Home",
    priceMinor: 70000,
    imageUrl: "/products/planter.svg",
    description:
      "A hand-thrown 8-inch terracotta planter with a drainage hole and a matching saucer. Plant not included. হাতে তৈরি পোড়ামাটির টব, প্লেটসহ।",
    attributes: { diameter: "8 inches", material: "Terracotta", drainage: "Yes, with saucer" },
    variants: [
      { sku: "TTP-08", title: "8 inch", options: { size: "8 inch" }, externalVariantId: "gid_ttp_08", stockQuantity: 22 },
      { sku: "TTP-12", title: "12 inch", options: { size: "12 inch" }, externalVariantId: "gid_ttp_12", priceOverrideMinor: 110000, stockQuantity: 9 },
    ],
  },
];

const knowledge = [
  {
    title: "Shipping & Delivery",
    content: `We ship across Bangladesh. Inside Dhaka delivery takes 2-3 business days and costs BDT 80. Outside Dhaka delivery takes 3-5 business days and costs BDT 150. Orders over BDT 3,000 qualify for free delivery anywhere in Bangladesh. Orders placed before 2 PM on a business day are usually handed to the courier the same day. Friday and public holidays are not business days. You will receive an SMS with a tracking link once the courier collects the parcel. We currently do not ship internationally.`,
  },
  {
    title: "Returns & Exchanges",
    content: `You may request a return or exchange within 7 days of delivery. Items must be unused, unwashed, and in their original packaging with tags attached. Innerwear, earphones and earbuds, and pierced jewellery cannot be returned for hygiene reasons unless the item arrived defective. To start a return, reply to your order confirmation SMS with your order number and a photo of the item. If the return is approved, we arrange a pickup inside Dhaka or ask you to courier the item to our office. Refunds are issued to the original payment method within 5-7 business days after inspection. Exchange delivery is free for defective items; otherwise a delivery charge may apply.`,
  },
  {
    title: "Payment Methods",
    content: `We accept bKash, Nagad, Visa, Mastercard, and cash on delivery inside Bangladesh. All online payments are processed on our secure checkout page. We never ask for your card number, PIN, OTP, or bKash PIN in chat. Cash on delivery is available for orders up to BDT 10,000 and may include a small handling fee. Payment is charged by the checkout, not by the chat assistant.`,
  },
  {
    title: "Product Care Guide",
    content: `Cotton panjabi: machine wash cold with similar colours, do not bleach, iron on medium heat. Handloom scarf: hand wash separately in cold water and dry in shade to protect the weave. Canvas bags: spot clean with mild soap and air dry; do not machine wash. Backpacks: wipe with a damp cloth and allow to dry fully before storing. Ceramic tea set: dishwasher safe, but hand washing preserves the glaze. Earbuds: clean the silicone tips with a dry cotton swab; do not immerse the case in water. Watches: 3 ATM means splash resistant; do not swim or shower with the watch.`,
  },
  {
    title: "Warranty & Support",
    content: `Wireless Earbuds Pro carry a 6-month warranty covering manufacturing defects in the battery and charging case. The Minimalist Wrist Watch carries a 1-year warranty covering the movement. Warranty does not cover physical damage, water damage beyond the stated rating, or normal wear. To claim warranty, contact support with your order number and a short video showing the issue. Our support hours are Saturday to Thursday, 10 AM to 7 PM Bangladesh time. For order-specific help, contact support@nokshibazaar.example.`,
  },
  {
    title: "Size Guide",
    content: `Cotton Panjabi (chest / length in inches): M 40 / 40, L 42 / 42, XL 44 / 43. Cotton Kurti (bust / length in inches): S 36 / 44, M 38 / 44, L 40 / 45. If you are between sizes, choose the larger size for a relaxed fit. Leather Sandals use EU sizing: 40 fits a 25.5 cm foot, 41 fits 26 cm, 42 fits 26.5 cm, 43 fits 27.5 cm, 44 fits 28 cm. Measure your foot in the evening and choose the size up if you are in between. Size exchanges are free within 7 days if the item is unused.`,
  },
  {
    title: "Gift Wrapping & Bulk Orders",
    content: `Gift wrapping with a handwritten card is available for BDT 100 per item; mention it in the order notes. We never include prices inside gift parcels. For corporate gifts or bulk orders of 20 or more pieces, we offer up to 12% discount and custom packaging; contact support@nokshibazaar.example with the product, quantity, and delivery date. Bulk orders need 7-10 business days to prepare.`,
  },
];

async function main() {
  const store = await prisma.store.upsert({
    where: { widgetKey: process.env.WIDGET_PUBLIC_KEY || "demo-widget-key" },
    update: {
      name: "Nokshi Bazaar",
      websiteDomain: new URL(process.env.APP_BASE_URL || "http://localhost:3000").host,
      currency: "BDT",
      defaultLocale: "en",
      supportedLocales: JSON.stringify(["en", "bn"]),
      shippingZones: JSON.stringify([
        { id: "dhaka", label: "Inside Dhaka (2-3 days)", feeMinor: 8000 },
        { id: "outside", label: "Outside Dhaka (3-5 days)", feeMinor: 15000 },
      ]),
      freeShippingOverMinor: 300000,
      codEnabled: true,
    },
    create: {
      name: "Nokshi Bazaar",
      websiteDomain: new URL(process.env.APP_BASE_URL || "http://localhost:3000").host,
      widgetKey: process.env.WIDGET_PUBLIC_KEY || "demo-widget-key",
      currency: "BDT",
      defaultLocale: "en",
      supportedLocales: JSON.stringify(["en", "bn"]),
      shippingZones: JSON.stringify([
        { id: "dhaka", label: "Inside Dhaka (2-3 days)", feeMinor: 8000 },
        { id: "outside", label: "Outside Dhaka (3-5 days)", feeMinor: 15000 },
      ]),
      freeShippingOverMinor: 300000,
      codEnabled: true,
    },
  });

  await prisma.productSource.upsert({ where: { storeId: store.id }, update: {}, create: { storeId: store.id } });

  await prisma.chatbotSettings.upsert({
    where: { storeId: store.id },
    update: {},
    create: {
      storeId: store.id,
      assistantName: "Nokshi Assistant",
      tone: "friendly",
      conversationStyle: "consultative",
      systemInstructions:
        "You are Nokshi Assistant, the shopping assistant for Nokshi Bazaar, a Bangladeshi lifestyle store. Be warm, concise, and practical. Prices are in BDT. Mention delivery charges and timelines from the shipping policy when relevant. Use the catalog and knowledge tools for every factual claim.",
      welcomeMessage:
        "Hi! I'm the Nokshi Bazaar assistant. Ask me about products, delivery, or returns. I can help you build a cart and take you to checkout.\n\nআসসালামু আলাইকুম! পণ্য, ডেলিভারি বা রিটার্ন নিয়ে বাংলায়ও জিজ্ঞাসা করতে পারেন।",
      fallbackMessage:
        "I could not find a verified answer for that. I can help with products in our catalog, delivery, returns, payments, and warranty, or connect you with support@nokshibazaar.example.",
      productGreeting:
        "Hi! You're looking at {product}. Want a quick overview, or do you have a question about it?",
      suggestedTopics: JSON.stringify([
        { label: "Looking for a product", prompt: "I'm looking for a product" },
        { label: "Delivery time", prompt: "How long does delivery take?" },
        { label: "Price list", prompt: "Can you show me your products and prices?" },
        { label: "Order status", prompt: "I want to check my order status" },
        { label: "Refund policy", prompt: "What is your refund and return policy?" },
      ]),
      enabledFeatures: JSON.stringify(["product_cards", "cart_tools", "knowledge_search", "orders"]),
      widgetTheme: JSON.stringify({ accent: "#0f766e", position: "right" }),
    },
  });

  const email = process.env.ADMIN_EMAIL || "admin@example.com";
  const password = process.env.ADMIN_PASSWORD || "admin12345";
  await prisma.adminUser.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: process.env.ADMIN_NAME || "Store Admin",
      passwordHash: hashPassword(password),
    },
  });

  for (const item of products) {
    const product = await prisma.product.upsert({
      where: { storeId_slug: { storeId: store.id, slug: item.slug } },
      update: {
        name: item.name,
        description: item.description,
        category: item.category,
        brand: item.brand,
        priceMinor: item.priceMinor,
        imageUrl: item.imageUrl,
        externalProductId: item.externalProductId,
        attributes: JSON.stringify(item.attributes),
        status: "active",
        currency: store.currency,
      },
      create: {
        storeId: store.id,
        slug: item.slug,
        name: item.name,
        description: item.description,
        category: item.category,
        brand: item.brand,
        priceMinor: item.priceMinor,
        imageUrl: item.imageUrl,
        externalProductId: item.externalProductId,
        attributes: JSON.stringify(item.attributes),
        currency: store.currency,
      },
    });

    for (const variant of item.variants) {
      await prisma.productVariant.upsert({
        where: { productId_sku: { productId: product.id, sku: variant.sku } },
        update: {
          title: variant.title,
          options: JSON.stringify(variant.options),
          externalVariantId: variant.externalVariantId,
          priceOverrideMinor: variant.priceOverrideMinor ?? null,
          stockStatus: variant.stockStatus || "in_stock",
          stockQuantity: variant.stockQuantity,
          storeId: store.id,
        },
        create: {
          storeId: store.id,
          productId: product.id,
          sku: variant.sku,
          title: variant.title,
          options: JSON.stringify(variant.options),
          externalVariantId: variant.externalVariantId,
          priceOverrideMinor: variant.priceOverrideMinor ?? null,
          stockStatus: variant.stockStatus || "in_stock",
          stockQuantity: variant.stockQuantity,
        },
      });
    }
  }

  for (const doc of knowledge) {
    await prisma.knowledgeDocument.upsert({
      where: { storeId_title: { storeId: store.id, title: doc.title } },
      update: { content: doc.content, contentHash: hashContent(doc.content), status: "ready" },
      create: {
        storeId: store.id,
        title: doc.title,
        content: doc.content,
        sourceType: "manual",
        status: "ready",
        contentHash: hashContent(doc.content),
      },
    });
  }

  console.log(`Seeded store "${store.name}" (${store.widgetKey}) with ${products.length} products and ${knowledge.length} knowledge documents.`);
  console.log(`Admin login: ${email} / ${password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
