import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/config/env";

function sign(payload: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(payload).digest("base64url");
}

export function seal(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function unseal<T extends Record<string, unknown>>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = sign(body);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    if (typeof parsed.exp === "number" && parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
