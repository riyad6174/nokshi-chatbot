"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import {
  MAPPING_FIELDS,
  SyncError,
  previewSource,
  syncProductSource,
  type FieldMapping,
  type NormalizedProduct,
} from "@/modules/catalog/product-sync.service";
import { getPrimaryStore, parseJsonObject } from "@/modules/stores/store.service";

const PATH = "/admin/chatbot";

async function adminStore() {
  await requireAdmin();
  const store = await getPrimaryStore();
  if (!store) redirect("/admin?error=store");
  return store;
}

function done(tab: string, error?: string): never {
  revalidatePath(PATH);
  redirect(`${PATH}?tab=${tab}&${error ? `error=${encodeURIComponent(error)}` : "saved=1"}`);
}

function readMapping(formData: FormData): Partial<FieldMapping> {
  const mapping: Partial<FieldMapping> = {};
  for (const field of MAPPING_FIELDS) {
    const value = String(formData.get(`map_${field.key}`) ?? "").trim().slice(0, 120);
    if (value) mapping[field.key] = value;
  }
  return mapping;
}

const sourceSchema = z.object({
  mode: z.enum(["manual", "api"]),
  apiUrl: z.string().trim().max(500),
  priceUnit: z.enum(["major", "minor"]),
  autoSync: z.boolean(),
  intervalMinutes: z.coerce.number().int().min(5).max(10_080),
});

function parseSource(formData: FormData) {
  return sourceSchema.safeParse({
    mode: formData.get("mode") ?? "manual",
    apiUrl: formData.get("apiUrl") ?? "",
    priceUnit: formData.get("priceUnit") ?? "major",
    autoSync: formData.get("autoSync") === "on",
    intervalMinutes: formData.get("intervalMinutes") ?? 60,
  });
}

export async function saveProductSourceAction(formData: FormData) {
  const store = await adminStore();
  const parsed = parseSource(formData);
  if (!parsed.success) done("products", parsed.error.issues[0]?.message ?? "Check the fields.");
  if (parsed.data.mode === "api" && !/^https?:\/\//i.test(parsed.data.apiUrl)) {
    done("products", "Enter the product API URL (starting with http:// or https://).");
  }

  const data = { ...parsed.data, mapping: JSON.stringify(readMapping(formData)) };
  await prisma.productSource.upsert({ where: { storeId: store.id }, update: data, create: { storeId: store.id, ...data } });
  logger.info("admin.product_source_saved", { storeId: store.id, mode: data.mode, autoSync: data.autoSync });

  if (parsed.data.mode === "api" && formData.get("intent") === "save_and_sync") {
    try {
      await syncProductSource(store.id);
    } catch (error) {
      done("products", error instanceof SyncError ? error.message : "The sync failed.");
    }
  }
  revalidatePath("/admin/products");
  done("products");
}

export type PreviewState = {
  error?: string | null;
  mapping?: FieldMapping;
  products?: NormalizedProduct[];
  count?: number;
  total?: number;
  skipped?: number;
};

export async function previewProductSourceAction(_previous: PreviewState | null, formData: FormData): Promise<PreviewState> {
  await adminStore();
  const url = String(formData.get("apiUrl") ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return { error: "Enter the product API URL first." };
  try {
    const result = await previewSource({
      url,
      mapping: readMapping(formData),
      priceUnit: formData.get("priceUnit") === "minor" ? "minor" : "major",
    });
    return {
      error: result.error,
      mapping: result.mapping,
      products: result.products,
      count: "count" in result ? result.count : 0,
      total: result.total,
      skipped: result.skipped.length,
    };
  } catch (error) {
    return { error: error instanceof SyncError ? error.message : "Couldn't read that API." };
  }
}

export async function syncNowAction() {
  const store = await adminStore();
  try {
    await syncProductSource(store.id);
  } catch (error) {
    done("products", error instanceof SyncError ? error.message : "The sync failed.");
  }
  revalidatePath("/admin/products");
  done("products");
}

const personalitySchema = z.object({
  assistantName: z.string().trim().min(1).max(60),
  tone: z.enum(["friendly", "professional", "playful", "luxury", "custom"]),
  customTone: z.string().trim().max(500),
  conversationStyle: z.enum(["straightforward", "explainer", "consultative"]),
  welcomeMessage: z.string().trim().min(1).max(1000),
  productGreeting: z.string().trim().max(500),
  fallbackMessage: z.string().trim().min(1).max(1000),
  systemInstructions: z.string().trim().max(8000),
});

export async function savePersonalityAction(formData: FormData) {
  const store = await adminStore();
  const parsed = personalitySchema.safeParse(Object.fromEntries(
    ["assistantName", "tone", "customTone", "conversationStyle", "welcomeMessage", "productGreeting", "fallbackMessage", "systemInstructions"].map(
      (key) => [key, formData.get(key) ?? ""],
    ),
  ));
  if (!parsed.success) done("personality", parsed.error.issues[0]?.message ?? "Check the fields.");
  if (parsed.data.tone === "custom" && !parsed.data.customTone) done("personality", "Describe the custom tone.");

  const topics: Array<{ label: string; prompt: string }> = [];
  for (let index = 0; index < 8; index += 1) {
    const label = String(formData.get(`topic_label_${index}`) ?? "").trim().slice(0, 40);
    const prompt = String(formData.get(`topic_prompt_${index}`) ?? "").trim().slice(0, 200);
    if (label) topics.push({ label, prompt: prompt || label });
  }

  await prisma.chatbotSettings.update({
    where: { storeId: store.id },
    data: { ...parsed.data, suggestedTopics: JSON.stringify(topics) },
  });
  done("personality");
}

const handoffSchema = z.object({
  handoffEnabled: z.boolean(),
  handoffAfterMisses: z.coerce.number().int().min(0).max(10),
  handoffKeywords: z.string().trim().max(1000),
});

export async function saveHandoffAction(formData: FormData) {
  const store = await adminStore();
  const parsed = handoffSchema.safeParse({
    handoffEnabled: formData.get("handoffEnabled") === "on",
    handoffAfterMisses: formData.get("handoffAfterMisses") ?? 2,
    handoffKeywords: formData.get("handoffKeywords") ?? "",
  });
  if (!parsed.success) done("handoff", parsed.error.issues[0]?.message ?? "Check the fields.");
  const keywords = [
    ...new Set(
      parsed.data.handoffKeywords
        .split(/[,\n]/)
        .map((keyword) => keyword.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 30);
  await prisma.chatbotSettings.update({
    where: { storeId: store.id },
    data: {
      handoffEnabled: parsed.data.handoffEnabled,
      handoffAfterMisses: parsed.data.handoffAfterMisses,
      handoffKeywords: JSON.stringify(keywords),
    },
  });
  done("handoff");
}

const featuresSchema = z.object({
  voiceEnabled: z.boolean(),
  attachmentsEnabled: z.boolean(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #0f766e"),
  position: z.enum(["left", "right"]),
});

export async function saveChatFeaturesAction(formData: FormData) {
  const store = await adminStore();
  const parsed = featuresSchema.safeParse({
    voiceEnabled: formData.get("voiceEnabled") === "on",
    attachmentsEnabled: formData.get("attachmentsEnabled") === "on",
    accent: formData.get("accent") ?? "#0f766e",
    position: formData.get("position") ?? "right",
  });
  if (!parsed.success) done("features", parsed.error.issues[0]?.message ?? "Check the fields.");
  const theme = { ...parseJsonObject(store.settings?.widgetTheme), accent: parsed.data.accent, position: parsed.data.position };
  await prisma.chatbotSettings.update({
    where: { storeId: store.id },
    data: {
      voiceEnabled: parsed.data.voiceEnabled,
      attachmentsEnabled: parsed.data.attachmentsEnabled,
      widgetTheme: JSON.stringify(theme),
    },
  });
  revalidatePath("/");
  done("features");
}
