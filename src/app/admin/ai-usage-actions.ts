"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import { logger } from "@/lib/logging/logger";
import { modelPricingFormSchema } from "@/lib/validation/schemas";
import { invalidatePricingCache, upsertModelPricing } from "@/modules/ai/pricing.service";
import { repriceUnpricedUsage } from "@/modules/analytics/usage.service";

const PATH = "/admin/ai-usage";

function done(error?: string, repriced = 0): never {
  revalidatePath(PATH);
  redirect(`${PATH}?${error ? `error=${encodeURIComponent(error)}` : `saved=pricing${repriced > 0 ? `&repriced=${repriced}` : ""}`}`);
}

export async function saveModelPricingAction(formData: FormData) {
  await requireAdmin();
  const parsed = modelPricingFormSchema.safeParse({
    id: formData.get("id") ?? "",
    providerId: formData.get("providerId") ?? "",
    model: formData.get("model") ?? "",
    inputPerMillion: formData.get("inputPerMillion") ?? 0,
    cachedInputPerMillion: formData.get("cachedInputPerMillion") ?? 0,
    cacheWritePerMillion: formData.get("cacheWritePerMillion") ?? 0,
    outputPerMillion: formData.get("outputPerMillion") ?? 0,
    audioInputPerMillion: formData.get("audioInputPerMillion") ?? "",
    cachedAudioInputPerMillion: formData.get("cachedAudioInputPerMillion") ?? "",
    audioOutputPerMillion: formData.get("audioOutputPerMillion") ?? "",
    active: formData.get("active") === "on",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) done(parsed.error.issues[0]?.message ?? "Check the pricing fields.");

  await upsertModelPricing(parsed.data);
  invalidatePricingCache();
  // Usage recorded before this price existed gets priced now, so conversation and total costs show it.
  const repriced = await repriceUnpricedUsage().catch((error) => {
    logger.warn("admin.reprice_failed", { error: error instanceof Error ? error.message : String(error) });
    return 0;
  });
  logger.info("admin.model_pricing_saved", {
    providerId: parsed.data.providerId,
    model: parsed.data.model,
    active: parsed.data.active,
    repriced,
  });
  done(undefined, repriced);
}
