import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  captureUnansweredQuestion,
  guessLanguage,
  listUnansweredQuestions,
  normalizeQuestion,
  updateUnansweredQuestion,
} from "@/modules/knowledge/learning.service";
import {
  archiveKnowledgeDocument,
  publishKnowledgeVersion,
  restoreKnowledgeDocument,
  snapshotKnowledgeVersion,
} from "@/modules/knowledge/versions.service";
import { resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function createDocument(content = "Delivery takes 2 days inside Dhaka.") {
  return prisma.knowledgeDocument.create({
    data: {
      storeId: fx.storeA.id,
      title: "Delivery times",
      content,
      sourceType: "manual",
      status: "pending",
      contentHash: hash(content),
      embedding: [],
    },
  });
}

describe("learning from unanswered questions", () => {
  it("normalizes the same question and counts repeated misses", async () => {
    expect(normalizeQuestion("  Do you DELIVER? ")).toBe("do you deliver");
    expect(normalizeQuestion("do you deliver")).toBe("do you deliver");
    expect(guessLanguage("Do you deliver?")).toBe("en");
    expect(guessLanguage("আপনারা কি ডেলিভারি দেন?")).toBe("bn");

    await captureUnansweredQuestion({
      storeId: fx.storeA.id,
      question: "Do you deliver?",
      channel: "text",
      intent: "shipping",
      outcome: "missed",
      reason: "knowledge_search_empty",
    });
    await captureUnansweredQuestion({
      storeId: fx.storeA.id,
      question: "do you deliver",
      channel: "voice",
      intent: "shipping",
      outcome: "missed",
      reason: "knowledge_search_empty",
    });

    const questions = await listUnansweredQuestions(fx.storeA.id, { statuses: ["new"] });
    expect(questions).toHaveLength(1);
    expect(questions[0].occurrences).toBe(2);
    expect(questions[0].channel).toBe("voice");
    expect(questions[0].question).toBe("do you deliver");
  });

  it("can mark a question answered and link the document that resolved it", async () => {
    await captureUnansweredQuestion({ storeId: fx.storeA.id, question: "What is the return policy?" });
    const [question] = await listUnansweredQuestions(fx.storeA.id);
    const document = await createDocument("Returns are accepted within 7 days.");

    expect(
      await updateUnansweredQuestion({
        storeId: fx.storeA.id,
        id: question.id,
        status: "answered",
        resolvedKnowledgeId: document.id,
      }),
    ).toBe(true);

    const updated = await prisma.unansweredQuestion.findUniqueOrThrow({ where: { id: question.id } });
    expect(updated.status).toBe("answered");
    expect(updated.resolvedKnowledgeId).toBe(document.id);
  });
});

describe("knowledge versions", () => {
  it("snapshots only real changes and publishes an exact older version", async () => {
    const document = await createDocument();
    const v1 = await snapshotKnowledgeVersion({
      storeId: fx.storeA.id,
      documentId: document.id,
      status: "draft",
      createdBy: "admin@example.com",
    });
    expect(v1?.version).toBe(1);
    const duplicate = await snapshotKnowledgeVersion({
      storeId: fx.storeA.id,
      documentId: document.id,
      status: "draft",
    });
    expect(duplicate?.id).toBe(v1?.id);

    await prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: { content: "Delivery takes 4 days.", contentHash: hash("Delivery takes 4 days.") },
    });
    const v2 = await snapshotKnowledgeVersion({
      storeId: fx.storeA.id,
      documentId: document.id,
      status: "published",
      createdBy: "admin@example.com",
    });
    expect(v2?.version).toBe(2);

    expect(
      await publishKnowledgeVersion({
        storeId: fx.storeA.id,
        documentId: document.id,
        versionId: v2!.id,
        createdBy: "admin@example.com",
      }),
    ).toEqual({ ok: true });

    const current = await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: document.id } });
    expect(current.status).toBe("ready");
    expect(current.content).toBe("Delivery takes 4 days.");
    expect(current.version).toBe(2);

    expect(
      await publishKnowledgeVersion({
        storeId: fx.storeA.id,
        documentId: document.id,
        versionId: v1!.id,
        createdBy: "admin@example.com",
      }),
    ).toEqual({ ok: true });

    const restored = await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: document.id } });
    expect(restored.content).toBe("Delivery takes 2 days inside Dhaka.");
    expect(restored.version).toBe(1);
    const versions = await prisma.knowledgeEntryVersion.findMany({
      where: { knowledgeDocumentId: document.id },
    });
    expect(versions.find((version) => version.id === v1!.id)?.status).toBe("published");
    expect(versions.find((version) => version.id === v2!.id)?.status).toBe("archived");
  });

  it("publishing clears cached answers, and archiving stops retrieval-safe state", async () => {
    const document = await createDocument();
    const version = await snapshotKnowledgeVersion({
      storeId: fx.storeA.id,
      documentId: document.id,
      status: "draft",
    });
    await prisma.answerCacheEntry.create({
      data: {
        storeId: fx.storeA.id,
        knowledgeDocumentId: document.id,
        knowledgeVersion: 1,
        questionHash: hash("delivery"),
        normalizedQuestion: "delivery",
        question: "How long is delivery?",
        answer: "Two days.",
        embedding: [],
      },
    });

    await publishKnowledgeVersion({
      storeId: fx.storeA.id,
      documentId: document.id,
      versionId: version!.id,
    });
    expect(
      await prisma.answerCacheEntry.count({ where: { knowledgeDocumentId: document.id } }),
    ).toBe(0);

    expect(await archiveKnowledgeDocument({ storeId: fx.storeA.id, documentId: document.id })).toBe(true);
    expect(
      (await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: document.id } })).status,
    ).toBe("archived");
    expect(await restoreKnowledgeDocument({ storeId: fx.storeA.id, documentId: document.id })).toBe(true);
    expect(
      (await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: document.id } })).status,
    ).toBe("ready");
  });
});
