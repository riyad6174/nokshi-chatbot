import { prisma } from "@/lib/db/prisma";
import { createSession, type SessionContext } from "@/modules/conversations/session.service";

export async function resetDb() {
  // Children first so relation emulation has nothing left to cascade.
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
