import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export type StoreWithSettings = Prisma.StoreGetPayload<{ include: { settings: true } }>;

export async function getStoreByWidgetKey(widgetKey: string): Promise<StoreWithSettings | null> {
  return prisma.store.findUnique({
    where: { widgetKey },
    include: { settings: true },
  });
}

export async function getPrimaryStore(): Promise<StoreWithSettings | null> {
  return prisma.store.findFirst({
    include: { settings: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function getStoreById(storeId: string): Promise<StoreWithSettings | null> {
  return prisma.store.findUnique({
    where: { id: storeId },
    include: { settings: true },
  });
}

export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
