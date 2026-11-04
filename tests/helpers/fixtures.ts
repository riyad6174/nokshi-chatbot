import { prisma } from "@/lib/db/prisma";
import { createSession, type SessionContext } from "@/modules/conversations/session.service";

export async function resetDb() {
  // Children first so relation emulation has nothing left to cascade.
  await prisma.marketingMessage.deleteMany();
  await prisma.marketingCampaign.deleteMany();
  await prisma.job.deleteMany();
  await prisma.aiTurnLog.deleteMany();
  await prisma.customerEvent.deleteMany();
  await prisma.customerProfile.deleteMany();
  await prisma.order.deleteMany();
  await prisma.upload.deleteMany();
  await prisma.checkoutSession.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.chatSession.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.chatbotSettings.deleteMany();
  await prisma.productSource.deleteMany();
  await prisma.store.deleteMany();
}

export type Fixture = Awaited<ReturnType<typeof seedFixture>>;

/**
 * Two stores so every test can assert that store A never sees store B's data.
 * Store A prices are in BDT minor units (paisa).
 */
export async function seedFixture() {
  const storeA = await prisma.store.create({
    data: {
      name: "Store A",
      websiteDomain: "shop-a.example",
      widgetKey: "key-a",
      currency: "BDT",
      defaultLocale: "en",
      supportedLocales: JSON.stringify(["en", "bn-BD"]),
      settings: {
        create: { welcomeMessage: "Hello from A", fallbackMessage: "Fallback from A" },
      },
    },
    include: { settings: true },
  });

  const storeB = await prisma.store.create({
    data: {
      name: "Store B",
      websiteDomain: "shop-b.example",
      widgetKey: "key-b",
      currency: "BDT",
      defaultLocale: "en",
      settings: {
        create: { welcomeMessage: "Hello from B", fallbackMessage: "Fallback from B" },
      },
    },
    include: { settings: true },
  });

  const backpack = await prisma.product.create({
    data: {
      storeId: storeA.id,
      name: "Trail Backpack",
      slug: "trail-backpack",
      description: "Water resistant 24L backpack with laptop sleeve.",
      category: "Bags",
      priceMinor: 250000,
      currency: "BDT",
      attributes: JSON.stringify({ capacity: "24L" }),
    },
  });
  const backpackBlack = await prisma.productVariant.create({
    data: { productId: backpack.id, storeId: storeA.id, sku: "TB-BLK", title: "Black", stockQuantity: 5 },
  });
  const backpackOlive = await prisma.productVariant.create({
    data: {
      productId: backpack.id,
      storeId: storeA.id,
      sku: "TB-OLV",
      title: "Olive",
      priceOverrideMinor: 270000,
      stockQuantity: 3,
    },
  });
  const backpackRed = await prisma.productVariant.create({
    data: {
      productId: backpack.id,
      storeId: storeA.id,
      sku: "TB-RED",
      title: "Red",
      stockStatus: "out_of_stock",
      stockQuantity: 0,
    },
  });

  const tote = await prisma.product.create({
    data: {
      storeId: storeA.id,
      name: "Canvas Tote",
      slug: "canvas-tote",
      description: "Sturdy cotton canvas tote bag.",
      category: "Bags",
      priceMinor: 120000,
      currency: "BDT",
    },
  });
  const toteNatural = await prisma.productVariant.create({
    data: { productId: tote.id, storeId: storeA.id, sku: "CT-NAT", title: "Natural" },
  });

  const scarf = await prisma.product.create({
    data: {
      storeId: storeA.id,
      name: "Handloom Scarf",
      slug: "handloom-scarf",
      description: "Handwoven cotton scarf.",
      category: "Accessories",
      priceMinor: 95000,
      currency: "BDT",
    },
  });

  const retired = await prisma.product.create({
    data: {
      storeId: storeA.id,
      name: "Retired Backpack",
      slug: "retired-backpack",
      description: "No longer sold.",
      category: "Bags",
      priceMinor: 100000,
      currency: "BDT",
      status: "inactive",
    },
  });

  const foreign = await prisma.product.create({
    data: {
      storeId: storeB.id,
      name: "Foreign Backpack",
      slug: "foreign-backpack",
      description: "A backpack that belongs to store B.",
      category: "Bags",
      priceMinor: 50000,
      currency: "BDT",
    },
  });

  await prisma.knowledgeDocument.create({
    data: {
      storeId: storeA.id,
      title: "Shipping & Delivery",
      content: "Inside Dhaka delivery takes 2-3 business days and costs BDT 80.",
      contentHash: "a1",
    },
  });
  await prisma.knowledgeDocument.create({
    data: {
      storeId: storeB.id,
      title: "Shipping & Delivery",
      content: "Store B ships by drone in one hour.",
      contentHash: "b1",
    },
  });

  return {
    storeA,
    storeB,
    products: { backpack, tote, scarf, retired, foreign },
    variants: { backpackBlack, backpackOlive, backpackRed, toteNatural },
  };
}

export async function newSession(widgetKey = "key-a"): Promise<SessionContext> {
  const session = await createSession({ widgetKey });
  if (!session) throw new Error(`No store for widget key ${widgetKey}`);
  return session;
}

export type SeedProduct = {
  name: string;
  category: string;
  priceMinor: number;
  attributes?: Record<string, string>;
  description?: string;
  status?: "active" | "inactive";
  /** Variants as [title, options, stockQuantity]; none = a simple product. */
  variants?: Array<{ title: string; options?: Record<string, string>; stockQuantity?: number | null; outOfStock?: boolean }>;
};

/** A store for one industry, with its sales configuration and catalog. Product ids are keyed by name. */
export async function seedIndustryStore(input: {
  widgetKey: string;
  industry: string;
  products: SeedProduct[];
  salesConfig?: Record<string, unknown>;
}) {
  const store = await prisma.store.create({
    data: {
      name: `${input.industry} store`,
      websiteDomain: `${input.widgetKey}.example`,
      widgetKey: input.widgetKey,
      currency: "BDT",
      defaultLocale: "en",
      supportedLocales: JSON.stringify(["en", "bn-BD"]),
      settings: {
        create: {
          welcomeMessage: "Hi",
          fallbackMessage: "Fallback",
          salesConfig: JSON.stringify({ industry: input.industry, ...(input.salesConfig ?? {}) }),
        },
      },
    },
    include: { settings: true },
  });
  const ids: Record<string, string> = {};
  for (const [index, product] of input.products.entries()) {
    const created = await prisma.product.create({
      data: {
        storeId: store.id,
        name: product.name,
        slug: `${product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index}`,
        description: product.description ?? `${product.name}.`,
        category: product.category,
        priceMinor: product.priceMinor,
        currency: "BDT",
        status: product.status ?? "active",
        attributes: JSON.stringify(product.attributes ?? {}),
      },
    });
    ids[product.name] = created.id;
    for (const [variantIndex, variant] of (product.variants ?? []).entries()) {
      await prisma.productVariant.create({
        data: {
          productId: created.id,
          storeId: store.id,
          sku: `${created.id.slice(-6)}-${variantIndex}`,
          title: variant.title,
          options: JSON.stringify(variant.options ?? {}),
          stockQuantity: variant.stockQuantity ?? null,
          stockStatus: variant.outOfStock ? "out_of_stock" : "in_stock",
        },
      });
    }
  }
  return { store, ids };
}

export const GROCERY_PRODUCTS: SeedProduct[] = [
  { name: "Fresh Potatoes 1kg", category: "Vegetables", priceMinor: 6000 },
  { name: "Red Onions 1kg", category: "Vegetables", priceMinor: 8000 },
  { name: "Green Chilies 250g", category: "Vegetables", priceMinor: 3000 },
  { name: "Turmeric Powder", category: "Spices", priceMinor: 9000 },
  { name: "Garlic 250g", category: "Vegetables", priceMinor: 5000, variants: [{ title: "250g", stockQuantity: 0, outOfStock: true }] },
  { name: "Soybean Cooking Oil 1L", category: "Oil", priceMinor: 19000 },
  { name: "Basmati Rice 5kg", category: "Rice", priceMinor: 95000 },
];

export const FASHION_PRODUCTS: SeedProduct[] = [
  { name: "Oxford Shirt", category: "Shirts", priceMinor: 220000, attributes: { color: "White", fit: "Slim" }, variants: [{ title: "M", options: { size: "M" } }, { title: "L", options: { size: "L" } }] },
  { name: "Beige Chinos", category: "Pants", priceMinor: 250000, attributes: { color: "Beige" } },
  { name: "Red Joggers", category: "Pants", priceMinor: 150000, attributes: { color: "Red" } },
  { name: "Luxury Navy Trousers", category: "Pants", priceMinor: 900000, attributes: { color: "Navy" } },
  { name: "Leather Belt", category: "Belts", priceMinor: 90000, attributes: { color: "Brown" } },
  { name: "Retired Khaki Pants", category: "Pants", priceMinor: 120000, attributes: { color: "Khaki" }, status: "inactive" },
];

export const ELECTRONICS_PRODUCTS: SeedProduct[] = [
  { name: "Phone X", category: "Phones", priceMinor: 4500000, attributes: { model: "Phone X", connector: "USB-C" } },
  { name: "Phone X Silicone Case", category: "Cases", priceMinor: 120000, attributes: { compatible_with: "Phone X" } },
  { name: "Phone Y Leather Case", category: "Cases", priceMinor: 150000, attributes: { compatible_with: "Phone Y" } },
  { name: "65W USB-C Charger", category: "Chargers", priceMinor: 250000, attributes: { connector: "USB-C" } },
  { name: "Lightning Cable", category: "Cables", priceMinor: 80000, attributes: { connector: "Lightning" } },
  { name: "Phone X Glass Protector", category: "Screen protectors", priceMinor: 60000, attributes: { compatible_with: "Phone X, Phone X Pro" }, variants: [{ title: "Clear", stockQuantity: 0 }] },
];
