import { z } from "zod";

// MongoDB ids are 24 hex chars. Prisma throws (instead of returning null) when a query gets a malformed id,
// so ids from requests, cookies and tool calls are checked before they reach a query.
const OBJECT_ID = /^[a-f0-9]{24}$/i;

export function isObjectId(value: unknown): value is string {
  return typeof value === "string" && OBJECT_ID.test(value);
}

export const objectIdSchema = z.string().regex(OBJECT_ID, "Invalid id");
