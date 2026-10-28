import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/config/env";

// AES-256-GCM for secrets stored in the database (e.g. AI provider API keys).
// The key is derived from AUTH_SECRET, so rotating AUTH_SECRET makes stored secrets unreadable
// and they must be re-entered in the dashboard.

const VERSION = "v1";

function key(): Buffer {
  return createHash("sha256").update(`stored-secret:${env.AUTH_SECRET}`).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

/** Returns null for empty input, or when the value was sealed with a different AUTH_SECRET or was tampered with. */
export function decryptSecret(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const [version, iv, tag, ciphertext] = sealed.split(":");
  if (version !== VERSION || !iv || !tag || !ciphertext) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function lastFour(secret: string): string {
  return secret.trim().slice(-4);
}
