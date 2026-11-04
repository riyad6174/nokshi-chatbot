import { registerJobHandler } from "@/modules/jobs/job.service";

// Every job type and its handler. Handlers import their modules lazily so the queue stays light.
let registered = false;

export function ensureJobHandlers() {
  if (registered) return;
  registered = true;
  registerJobHandler("marketing.send", async (job, payload) => (await import("@/modules/marketing/campaign.service")).handleSendJob(job, payload));
  registerJobHandler("marketing.abandoned_cart", async (job, payload) =>
    (await import("@/modules/marketing/campaign.service")).handleAbandonedCartJob(job, payload),
  );
  registerJobHandler("embeddings.refresh", async (_job, payload) => {
    const storeId = typeof payload.storeId === "string" ? payload.storeId : "";
    if (!storeId) return;
    const { refreshKnowledgeEmbeddings, refreshProductEmbeddings } = await import("@/modules/search/embeddings.service");
    await refreshProductEmbeddings(storeId);
    await refreshKnowledgeEmbeddings(storeId);
  });
}
