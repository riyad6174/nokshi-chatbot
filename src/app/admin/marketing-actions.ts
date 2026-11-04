"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { logger } from "@/lib/logging/logger";
import { createCampaign, launchCampaign, setCampaignStatus } from "@/modules/marketing/campaign.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

const PATH = "/admin/marketing";

async function adminStore() {
  await requireAdmin();
  const store = await getPrimaryStore();
  if (!store) redirect("/admin?error=store");
  return store;
}

function done(message: { error?: string; saved?: string }): never {
  revalidatePath(PATH);
  const query = message.error ? `error=${encodeURIComponent(message.error)}` : `saved=${encodeURIComponent(message.saved ?? "1")}`;
  redirect(`${PATH}?${query}`);
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const optionalInt = (formData: FormData, key: string) => {
  const value = text(formData, key);
  return value ? Number.parseInt(value, 10) : undefined;
};
const list = (value: string) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

export async function createCampaignAction(formData: FormData) {
  const store = await adminStore();
  try {
    const spent = text(formData, "spentAtLeast");
    await createCampaign(store.id, {
      name: text(formData, "name"),
      kind: text(formData, "kind") as "broadcast",
      channel: text(formData, "channel") as "email",
      subject: text(formData, "subject"),
      body: text(formData, "body"),
      delayMinutes: optionalInt(formData, "delayMinutes") ?? 60,
      segment: {
        minOrders: optionalInt(formData, "minOrders"),
        maxOrders: optionalInt(formData, "maxOrders"),
        seenWithinDays: optionalInt(formData, "seenWithinDays"),
        inactiveForDays: optionalInt(formData, "inactiveForDays"),
        spentAtLeastMinor: spent ? Math.round(Number(spent) * 100) : undefined,
        interestsAny: list(text(formData, "interestsAny")).length ? list(text(formData, "interestsAny")) : undefined,
        categoriesAny: list(text(formData, "categoriesAny")).length ? list(text(formData, "categoriesAny")) : undefined,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      done({ error: `${issue?.path.join(" › ") || "Campaign"}: ${issue?.message ?? "invalid"}` });
    }
    throw error;
  }
  done({ saved: "Campaign created as a draft." });
}

export async function launchCampaignAction(formData: FormData) {
  const store = await adminStore();
  const id = text(formData, "campaignId");
  let result: { queued: number; skipped: number };
  try {
    result = await launchCampaign(store.id, id);
  } catch (error) {
    logger.warn("admin.campaign_launch_failed", { error: error instanceof Error ? error.message : String(error) });
    done({ error: "That campaign couldn't be launched." });
  }
  done({ saved: result.queued || result.skipped ? `Queued ${result.queued} message(s); ${result.skipped} customer(s) skipped (no consent or contact).` : "Automation is on." });
}

export async function setCampaignStatusAction(formData: FormData) {
  const store = await adminStore();
  const status = text(formData, "status") === "paused" ? "paused" : "active";
  await setCampaignStatus(store.id, text(formData, "campaignId"), status);
  done({ saved: status === "paused" ? "Automation paused." : "Automation is on." });
}
