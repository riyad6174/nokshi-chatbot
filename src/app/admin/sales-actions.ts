"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import {
  ENGAGEMENT_TRIGGERS,
  INDUSTRIES,
  presetConfig,
  resolveSalesConfig,
  validateSalesConfig,
  type Industry,
} from "@/modules/sales/config";
import { FormatError, parseLines, parseMap, parseRecipes, parseRelationships } from "@/modules/sales/admin-format";
import { getPrimaryStore } from "@/modules/stores/store.service";

const PATH = "/admin/sales";

async function adminStore() {
  await requireAdmin();
  const store = await getPrimaryStore();
  if (!store?.settings) redirect("/admin?error=store");
  return store;
}

function done(error?: string): never {
  revalidatePath(PATH);
  redirect(`${PATH}?${error ? `error=${encodeURIComponent(error)}` : "saved=1"}`);
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const flag = (formData: FormData, key: string) => formData.get(key) === "on";
const int = (formData: FormData, key: string, fallback: number) => {
  const value = Number.parseInt(text(formData, key), 10);
  return Number.isFinite(value) ? value : fallback;
};

/** Replaces the configuration with an industry preset (the owner's assistant name, tone and prompts are untouched). */
export async function applySalesPresetAction(formData: FormData) {
  const store = await adminStore();
  const industry = text(formData, "industry") as Industry;
  if (!INDUSTRIES.includes(industry)) done("Choose an industry.");
  const config = presetConfig(industry);
  await prisma.chatbotSettings.update({ where: { storeId: store.id }, data: { salesConfig: JSON.stringify(config) } });
  logger.info("admin.sales_preset_applied", { storeId: store.id, industry });
  done();
}

export async function saveSalesConfigAction(formData: FormData) {
  const store = await adminStore();
  const current = resolveSalesConfig(store.settings);
  try {
    const highValue = text(formData, "highValueCart");
    const config = validateSalesConfig({
      ...current,
      enabled: flag(formData, "enabled"),
      industry: text(formData, "industry") || current.industry,
      businessType: text(formData, "businessType"),
      persona: { role: text(formData, "role"), personality: text(formData, "personality") },
      conversationRules: parseLines(text(formData, "conversationRules")),
      recommendation: {
        strategy: text(formData, "strategy") || current.recommendation.strategy,
        maxPerReply: int(formData, "maxPerReply", current.recommendation.maxPerReply),
        maxAddOnsPerConversation: int(formData, "maxAddOns", current.recommendation.maxAddOnsPerConversation),
        explainReasons: flag(formData, "explainReasons"),
      },
      relationships: parseRelationships(text(formData, "relationships")),
      recipes: parseRecipes(text(formData, "recipes")),
      colorPairings: parseMap(text(formData, "colorPairings"), "Colour pairing"),
      compatibilityAttributes: text(formData, "compatibilityAttributes")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
      synonyms: parseMap(text(formData, "synonyms"), "Synonym"),
      engagement: {
        enabled: flag(formData, "engagementEnabled"),
        triggers: Object.fromEntries(
          ENGAGEMENT_TRIGGERS.map((trigger) => [
            trigger,
            { enabled: flag(formData, `trigger_${trigger}`), delaySeconds: int(formData, `delay_${trigger}`, 0) },
          ]),
        ),
        maxPerSession: int(formData, "maxPerSession", current.engagement.maxPerSession),
        minSecondsBetween: int(formData, "minSecondsBetween", current.engagement.minSecondsBetween),
        suppressDuringCheckout: flag(formData, "suppressDuringCheckout"),
        nudgeWhenClosed: flag(formData, "nudgeWhenClosed"),
      },
      messages: {
        recipe: text(formData, "msg_recipe"),
        complete_the_look: text(formData, "msg_complete_the_look"),
        compatible: text(formData, "msg_compatible"),
        complementary: text(formData, "msg_complementary"),
        cart_idle: text(formData, "msg_cart_idle"),
        checkout_start: text(formData, "msg_checkout_start"),
      },
      salesGoals: {
        checkoutGuidance: text(formData, "checkoutGuidance") || current.salesGoals.checkoutGuidance,
        freeShippingNudge: flag(formData, "freeShippingNudge"),
        upsell: flag(formData, "upsell"),
        notes: text(formData, "goalNotes"),
      },
      handoff: {
        highValueCartMinor: highValue ? Math.round(Number(highValue) * 100) : null,
        offerWhenUndecided: flag(formData, "offerWhenUndecided"),
      },
      features: {
        attachmentUnderstanding: flag(formData, "attachmentUnderstanding"),
        semanticSearch: flag(formData, "semanticSearch"),
      },
    });
    await prisma.chatbotSettings.update({ where: { storeId: store.id }, data: { salesConfig: JSON.stringify(config) } });
    logger.info("admin.sales_config_saved", { storeId: store.id, industry: config.industry, engagement: config.engagement.enabled });
  } catch (error) {
    if (error instanceof FormatError) done(error.message);
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      done(`${issue?.path.join(" › ") || "Settings"}: ${issue?.message ?? "invalid value"}`);
    }
    throw error;
  }
  done();
}
