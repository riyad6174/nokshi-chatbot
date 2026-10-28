"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import {
  HandoffError,
  agentReply,
  agentTakeOver,
  closeConversation,
  releaseToBot,
} from "@/modules/conversations/handoff.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

async function context() {
  const admin = await requireAdmin();
  const store = await getPrimaryStore();
  if (!store) redirect("/admin?error=store");
  return { admin, store, adminName: admin.name || admin.email.split("@")[0]! };
}

function back(conversationId: string, error?: string): never {
  revalidatePath("/admin/inbox");
  redirect(`/admin/inbox/${encodeURIComponent(conversationId)}${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

export async function takeOverAction(formData: FormData) {
  const { admin, store, adminName } = await context();
  const conversationId = String(formData.get("conversationId") ?? "");
  try {
    await agentTakeOver({ storeId: store.id, conversationId, adminId: admin.id, adminName });
  } catch (error) {
    back(conversationId, error instanceof HandoffError ? error.message : "Couldn't take over.");
  }
  back(conversationId);
}

export async function releaseAction(formData: FormData) {
  const { store, adminName } = await context();
  const conversationId = String(formData.get("conversationId") ?? "");
  try {
    await releaseToBot({ storeId: store.id, conversationId, adminName });
  } catch (error) {
    back(conversationId, error instanceof HandoffError ? error.message : "Couldn't hand back.");
  }
  back(conversationId);
}

export async function closeAction(formData: FormData) {
  const { store } = await context();
  const conversationId = String(formData.get("conversationId") ?? "");
  try {
    await closeConversation({ storeId: store.id, conversationId });
  } catch (error) {
    back(conversationId, error instanceof HandoffError ? error.message : "Couldn't close.");
  }
  back(conversationId);
}

export type ReplyState = { ok?: boolean; error?: string; sentAt?: number };

const replySchema = z.object({
  conversationId: z.string().min(1).max(50),
  text: z.string().trim().min(1, "Type a reply").max(2000),
});

export async function replyAction(_previous: ReplyState, formData: FormData): Promise<ReplyState> {
  const { admin, store, adminName } = await context();
  const parsed = replySchema.safeParse({ conversationId: formData.get("conversationId"), text: formData.get("text") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Type a reply." };
  try {
    await agentReply({ storeId: store.id, conversationId: parsed.data.conversationId, adminId: admin.id, adminName, text: parsed.data.text });
  } catch (error) {
    return { error: error instanceof HandoffError ? error.message : "The reply couldn't be sent." };
  }
  revalidatePath(`/admin/inbox/${parsed.data.conversationId}`);
  return { ok: true, sentAt: Date.now() };
}
