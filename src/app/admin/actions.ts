"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/auth/admin";
import { getPrimaryStore, parseJsonObject } from "@/modules/stores/store.service";
import {
  chatbotSettingsFormSchema,
  knowledgeFormSchema,
  productFormSchema,
  storeSettingsFormSchema,
  variantFormSchema,
} from "@/lib/validation/schemas";
import { logger } from "@/lib/logging/logger";

function fail(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}

async function getAdminStore() {
  await requireAdmin();
  const store = await getPrimaryStore();
  if (!store) redirect("/admin?error=store");
  return store;
}

function validateImageUrl(value: string | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/") || /^https?:\/\//i.test(value)) return value;
  return null;
}

function parseOptions(raw: string): string | null {
  if (!raw.trim()) return "{}";
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

function firstIssue(
  path: string,
  issues: Array<{ path: (string | number)[]; message: string }>,
  fallbackPath: string,
): never {
  fail(path, issues[0]?.message || fallbackPath);
}

export async function createProductAction(formData: FormData) {
  const store = await getAdminStore();
  const path = "/admin/products/new";
  const parsed = productFormSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    description: formData.get("description") ?? "",
    category: formData.get("category"),
    price: formData.get("price"),
    imageUrl: formData.get("imageUrl") ?? "",
    externalProductId: formData.get("externalProductId") ?? "",
    status: formData.get("status") ?? "active",
  });
  if (!parsed.success) firstIssue(path, parsed.error.issues, "Check the product fields.");

  const existing = await prisma.product.findUnique({
    where: { storeId_slug: { storeId: store.id, slug: parsed.data.slug } },
    select: { id: true },
  });
  if (existing) fail(path, "That slug is already in use in this store.");

  const product = await prisma.product.create({
    data: {
      storeId: store.id,
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description,
      category: parsed.data.category,
      priceMinor: Math.round(parsed.data.price * 100),
      currency: store.currency,
      imageUrl: validateImageUrl(parsed.data.imageUrl || undefined),
      externalProductId: parsed.data.externalProductId || null,
      status: parsed.data.status,
      attributes: "{}",
    },
  });

  logger.info("admin.product_created", { productId: product.id, storeId: store.id });
  revalidatePath("/admin/products");
  revalidatePath("/");
  redirect(`/admin/products/${product.id}?created=1`);
}

export async function updateProductAction(formData: FormData) {
  const store = await getAdminStore();
  const id = String(formData.get("id") || "");
  const path = `/admin/products/${id}`;
  if (!id) fail("/admin/products", "Missing product id.");

  const product = await prisma.product.findFirst({ where: { id, storeId: store.id }, select: { id: true } });
  if (!product) fail("/admin/products", "Product not found.");

  const parsed = productFormSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    description: formData.get("description") ?? "",
    category: formData.get("category"),
    price: formData.get("price"),
    imageUrl: formData.get("imageUrl") ?? "",
    externalProductId: formData.get("externalProductId") ?? "",
    status: formData.get("status") ?? "active",
  });
  if (!parsed.success) firstIssue(path, parsed.error.issues, "Check the product fields.");

  const duplicate = await prisma.product.findFirst({
    where: { storeId: store.id, slug: parsed.data.slug, id: { not: id } },
    select: { id: true },
  });
  if (duplicate) fail(path, "That slug is already in use in this store.");

  await prisma.product.update({
    where: { id },
    data: {
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description,
      category: parsed.data.category,
      priceMinor: Math.round(parsed.data.price * 100),
      imageUrl: validateImageUrl(parsed.data.imageUrl || undefined),
      externalProductId: parsed.data.externalProductId || null,
      status: parsed.data.status,
    },
  });

  revalidatePath("/admin/products");
  revalidatePath(path);
  revalidatePath("/");
  redirect(`${path}?saved=1`);
}

export async function deleteProductAction(formData: FormData) {
  const store = await getAdminStore();
  const id = String(formData.get("id") || "");
  if (!id) fail("/admin/products", "Missing product id.");

  const product = await prisma.product.findFirst({ where: { id, storeId: store.id }, select: { id: true } });
  if (!product) fail("/admin/products", "Product not found.");

  await prisma.product.delete({ where: { id } });
  logger.info("admin.product_deleted", { productId: id, storeId: store.id });
  revalidatePath("/admin/products");
  revalidatePath("/");
  redirect("/admin/products");
}

export async function createVariantAction(formData: FormData) {
  const store = await getAdminStore();
  const productId = String(formData.get("productId") || "");
  const path = `/admin/products/${productId}`;
  const product = await prisma.product.findFirst({
    where: { id: productId, storeId: store.id },
    select: { id: true },
  });
  if (!product) fail("/admin/products", "Product not found.");

  const priceOverrideRaw = String(formData.get("priceOverride") || "").trim();
  const stockQuantityRaw = String(formData.get("stockQuantity") || "").trim();
  const parsed = variantFormSchema.safeParse({
    productId,
    sku: formData.get("sku"),
    title: formData.get("title"),
    externalVariantId: formData.get("externalVariantId") ?? "",
    priceOverride: priceOverrideRaw === "" ? undefined : priceOverrideRaw,
    stockQuantity: stockQuantityRaw === "" ? undefined : stockQuantityRaw,
    stockStatus: formData.get("stockStatus") ?? "in_stock",
    options: formData.get("options") ?? "{}",
  });
  if (!parsed.success) firstIssue(path, parsed.error.issues, "Check the variant fields.");

  const options = parseOptions(parsed.data.options);
  if (options === null) fail(path, "Variant options must be a JSON object, e.g. {\"color\":\"Black\"}.");

  const duplicate = await prisma.productVariant.findFirst({
    where: { productId, sku: parsed.data.sku },
    select: { id: true },
  });
  if (duplicate) fail(path, "That SKU already exists for this product.");

  await prisma.productVariant.create({
    data: {
      storeId: store.id,
      productId,
      sku: parsed.data.sku,
      title: parsed.data.title,
      options,
      externalVariantId: parsed.data.externalVariantId || null,
      priceOverrideMinor:
        parsed.data.priceOverride != null ? Math.round(parsed.data.priceOverride * 100) : null,
      stockQuantity: parsed.data.stockQuantity ?? null,
      stockStatus: parsed.data.stockStatus,
    },
  });

  revalidatePath(path);
  revalidatePath("/admin/products");
  revalidatePath("/");
  redirect(`${path}?saved=1`);
}

export async function updateVariantStockAction(formData: FormData) {
  const store = await getAdminStore();
  const variantId = String(formData.get("variantId") || "");
  const productId = String(formData.get("productId") || "");
  const path = `/admin/products/${productId}`;
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, storeId: store.id },
    select: { id: true },
  });
  if (!variant) fail(path, "Variant not found.");

  const stockQuantityRaw = String(formData.get("stockQuantity") || "").trim();
  const stockStatus = String(formData.get("stockStatus") || "in_stock");
  if (!["in_stock", "out_of_stock"].includes(stockStatus)) fail(path, "Invalid stock status.");

  await prisma.productVariant.update({
    where: { id: variantId },
    data: {
      stockStatus,
      stockQuantity: stockQuantityRaw === "" ? null : Math.max(0, Number.parseInt(stockQuantityRaw, 10) || 0),
    },
  });

  revalidatePath(path);
  revalidatePath("/");
  redirect(`${path}?saved=1`);
}

export async function deleteVariantAction(formData: FormData) {
  const store = await getAdminStore();
  const variantId = String(formData.get("variantId") || "");
  const productId = String(formData.get("productId") || "");
  const path = `/admin/products/${productId}`;
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, storeId: store.id },
    select: { id: true },
  });
  if (!variant) fail(path, "Variant not found.");

  await prisma.productVariant.delete({ where: { id: variantId } });
  revalidatePath(path);
  revalidatePath("/");
  redirect(`${path}?saved=1`);
}

export async function createKnowledgeAction(formData: FormData) {
  const store = await getAdminStore();
  const path = "/admin/knowledge/new";
  const parsed = knowledgeFormSchema.safeParse({
    title: formData.get("title"),
    content: formData.get("content"),
    sourceType: formData.get("sourceType") ?? "manual",
    sourceReference: formData.get("sourceReference") ?? "",
    status: formData.get("status") ?? "ready",
  });
  if (!parsed.success) firstIssue(path, parsed.error.issues, "Check the knowledge fields.");

  const duplicate = await prisma.knowledgeDocument.findFirst({
    where: { storeId: store.id, title: parsed.data.title },
    select: { id: true },
  });
  if (duplicate) fail(path, "A document with that title already exists.");

  await prisma.knowledgeDocument.create({
    data: {
      storeId: store.id,
      title: parsed.data.title,
      content: parsed.data.content,
      sourceType: parsed.data.sourceType,
      sourceReference: parsed.data.sourceReference || null,
      status: parsed.data.status,
      contentHash: createHash("sha256").update(parsed.data.content).digest("hex"),
    },
  });

  revalidatePath("/admin/knowledge");
  redirect("/admin/knowledge?saved=1");
}

export async function updateKnowledgeAction(formData: FormData) {
  const store = await getAdminStore();
  const id = String(formData.get("id") || "");
  const path = `/admin/knowledge/${id}`;
  const doc = await prisma.knowledgeDocument.findFirst({
    where: { id, storeId: store.id },
    select: { id: true },
  });
  if (!doc) fail("/admin/knowledge", "Document not found.");

  const parsed = knowledgeFormSchema.safeParse({
    title: formData.get("title"),
    content: formData.get("content"),
    sourceType: formData.get("sourceType") ?? "manual",
    sourceReference: formData.get("sourceReference") ?? "",
    status: formData.get("status") ?? "ready",
  });
  if (!parsed.success) firstIssue(path, parsed.error.issues, "Check the knowledge fields.");

  const duplicate = await prisma.knowledgeDocument.findFirst({
    where: { storeId: store.id, title: parsed.data.title, id: { not: id } },
    select: { id: true },
  });
  if (duplicate) fail(path, "A document with that title already exists.");

  await prisma.knowledgeDocument.update({
    where: { id },
    data: {
      title: parsed.data.title,
      content: parsed.data.content,
      sourceType: parsed.data.sourceType,
      sourceReference: parsed.data.sourceReference || null,
      status: parsed.data.status,
      contentHash: createHash("sha256").update(parsed.data.content).digest("hex"),
    },
  });

  revalidatePath("/admin/knowledge");
  revalidatePath(path);
  redirect("/admin/knowledge?saved=1");
}

export async function deleteKnowledgeAction(formData: FormData) {
  const store = await getAdminStore();
  const id = String(formData.get("id") || "");
  const doc = await prisma.knowledgeDocument.findFirst({
    where: { id, storeId: store.id },
    select: { id: true },
  });
  if (!doc) fail("/admin/knowledge", "Document not found.");

  await prisma.knowledgeDocument.delete({ where: { id } });
  revalidatePath("/admin/knowledge");
  redirect("/admin/knowledge?saved=1");
}

export async function updateStoreSettingsAction(formData: FormData) {
  const store = await getAdminStore();
  const path = "/admin/settings";
  const parsed = storeSettingsFormSchema.safeParse({
    name: formData.get("name"),
    websiteDomain: formData.get("websiteDomain"),
    currency: formData.get("currency"),
    defaultLocale: formData.get("defaultLocale"),
    supportedLocales: formData.get("supportedLocales"),
    trustedCheckoutHosts: formData.get("trustedCheckoutHosts") ?? "",
  });
  if (!parsed.success) firstIssue(path, parsed.error.issues, "Check the store fields.");

  const locales = parsed.data.supportedLocales
    .split(",")
    .map((locale) => locale.trim())
    .filter(Boolean);
  if (!locales.includes(parsed.data.defaultLocale)) locales.unshift(parsed.data.defaultLocale);
  const trusts = parsed.data.trustedCheckoutHosts
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  await prisma.store.update({
    where: { id: store.id },
    data: {
      name: parsed.data.name,
      websiteDomain: parsed.data.websiteDomain,
      currency: parsed.data.currency,
      defaultLocale: parsed.data.defaultLocale,
      supportedLocales: JSON.stringify([...new Set(locales)]),
      trustedCheckoutHosts: JSON.stringify([...new Set(trusts)]),
    },
  });

  revalidatePath("/admin/settings");
  revalidatePath("/");
  redirect(`${path}?saved=1`);
}

export async function updateChatbotSettingsAction(formData: FormData) {
  const store = await getAdminStore();
  const path = "/admin/settings";
  const parsed = chatbotSettingsFormSchema.safeParse({
    welcomeMessage: formData.get("welcomeMessage"),
    fallbackMessage: formData.get("fallbackMessage"),
    systemInstructions: formData.get("systemInstructions") ?? "",
    accentColor: formData.get("accentColor") ?? "#0f766e",
    enabledFeatures: formData.get("enabledFeatures") ?? "",
  });
  if (!parsed.success) firstIssue(path, parsed.error.issues, "Check the chatbot fields.");

  const features = parsed.data.enabledFeatures
    .split(",")
    .map((feature) => feature.trim())
    .filter(Boolean);
  const existingTheme = parseJsonObject(store.settings?.widgetTheme);
  const theme = {
    ...existingTheme,
    accent: parsed.data.accentColor,
    position: existingTheme.position === "left" ? "left" : "right",
  };

  await prisma.chatbotSettings.upsert({
    where: { storeId: store.id },
    update: {
      welcomeMessage: parsed.data.welcomeMessage,
      fallbackMessage: parsed.data.fallbackMessage,
      systemInstructions: parsed.data.systemInstructions,
      enabledFeatures: JSON.stringify(features.length > 0 ? features : ["product_cards", "cart_tools", "knowledge_search"]),
      widgetTheme: JSON.stringify(theme),
    },
    create: {
      storeId: store.id,
      welcomeMessage: parsed.data.welcomeMessage,
      fallbackMessage: parsed.data.fallbackMessage,
      systemInstructions: parsed.data.systemInstructions,
      enabledFeatures: JSON.stringify(features.length > 0 ? features : ["product_cards", "cart_tools", "knowledge_search"]),
      widgetTheme: JSON.stringify(theme),
    },
  });

  revalidatePath("/admin/settings");
  revalidatePath("/");
  redirect(`${path}?saved=1`);
}

export async function deleteConversationAction(formData: FormData) {
  const store = await getAdminStore();
  const id = String(formData.get("id") || "");
  const conversation = await prisma.conversation.findFirst({
    where: { id, storeId: store.id },
    select: { id: true },
  });
  if (!conversation) fail("/admin/conversations", "Conversation not found.");

  await prisma.conversation.delete({ where: { id } });
  logger.info("admin.conversation_deleted", { conversationId: id, storeId: store.id });
  revalidatePath("/admin/conversations");
  redirect("/admin/conversations?saved=1");
}

const deliverySchema = z.object({
  zones: z.string().max(2000),
  freeShippingOver: z.string().trim().max(20),
  codEnabled: z.boolean(),
});

/** Zones are entered one per line as "Label = fee", e.g. "Inside Dhaka (2-3 days) = 80". */
export async function updateDeliverySettingsAction(formData: FormData) {
  const store = await getAdminStore();
  const path = "/admin/settings";
  const parsed = deliverySchema.safeParse({
    zones: formData.get("zones") ?? "",
    freeShippingOver: formData.get("freeShippingOver") ?? "",
    codEnabled: formData.get("codEnabled") === "on",
  });
  if (!parsed.success) fail(path, "Check the delivery fields.");

  const zones: Array<{ id: string; label: string; feeMinor: number }> = [];
  for (const [index, line] of parsed.data.zones.split("\n").entries()) {
    if (!line.trim()) continue;
    const match = line.match(/^(.+?)\s*=\s*([\d.,]+)\s*$/);
    if (!match) fail(path, `Line ${index + 1}: use "Area name = fee", e.g. "Inside Dhaka = 80".`);
    const fee = Number.parseFloat(match[2]!.replace(/,/g, ""));
    if (!Number.isFinite(fee) || fee < 0) fail(path, `Line ${index + 1}: the fee must be a number.`);
    zones.push({ id: `zone-${zones.length + 1}`, label: match[1]!.trim().slice(0, 80), feeMinor: Math.round(fee * 100) });
  }
  const freeOver = parsed.data.freeShippingOver ? Number.parseFloat(parsed.data.freeShippingOver.replace(/,/g, "")) : null;
  if (freeOver !== null && (!Number.isFinite(freeOver) || freeOver < 0)) fail(path, "Free delivery threshold must be a number.");

  await prisma.store.update({
    where: { id: store.id },
    data: {
      shippingZones: JSON.stringify(zones.slice(0, 20)),
      freeShippingOverMinor: freeOver === null ? null : Math.round(freeOver * 100),
      codEnabled: parsed.data.codEnabled,
    },
  });
  revalidatePath(path);
  redirect(`${path}?saved=1`);
}
