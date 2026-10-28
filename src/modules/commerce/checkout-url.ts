import { env } from "@/lib/config/env";
import type { Store } from "@prisma/client";
import { parseJsonArray } from "@/modules/stores/store.service";

export class UntrustedCheckoutUrlError extends Error {
  constructor(message = "The checkout URL is not on an approved host.") {
    super(message);
    this.name = "UntrustedCheckoutUrlError";
  }
}

function normalizeHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  try {
    if (trimmed.includes("://")) return new URL(trimmed).host.toLowerCase();
    return new URL(`https://${trimmed}`).host.toLowerCase();
  } catch {
    return trimmed.replace(/^\/+|\/+$/g, "").toLowerCase();
  }
}

type TrustedHostSource = Pick<Store, "websiteDomain"> & Partial<Pick<Store, "trustedCheckoutHosts">>;

export function allowedCheckoutHosts(store: TrustedHostSource): string[] {
  const hosts = new Set<string>();
  hosts.add(normalizeHost(store.websiteDomain));
  try {
    hosts.add(new URL(env.APP_BASE_URL).host.toLowerCase());
  } catch {
    // APP_BASE_URL is validated at startup.
  }
  // Hosts configured per store in the admin settings, plus deployment-wide hosts from the environment.
  for (const host of [...parseJsonArray(store.trustedCheckoutHosts), ...env.trustedCheckoutHosts]) {
    hosts.add(normalizeHost(host));
  }
  return [...hosts].filter(Boolean);
}

export function assertTrustedCheckoutUrl(url: string, store: TrustedHostSource): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UntrustedCheckoutUrlError("The checkout URL is malformed.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new UntrustedCheckoutUrlError("The checkout URL must use HTTP or HTTPS.");
  }

  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !isLocal && env.isProduction) {
    throw new UntrustedCheckoutUrlError("The checkout URL must use HTTPS in production.");
  }

  const allowed = allowedCheckoutHosts(store);
  if (!allowed.includes(parsed.host.toLowerCase())) {
    throw new UntrustedCheckoutUrlError();
  }

  return parsed;
}
