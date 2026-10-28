import type { NextRequest } from "next/server";
import { seal, unseal } from "@/lib/auth/tokens";

export const WIDGET_COOKIE = "nb_widget";
// Embedded widgets run in a third-party iframe where browsers block or partition cookies,
// so they send the same signed token in this header instead.
export const WIDGET_TOKEN_HEADER = "x-widget-session";
const WIDGET_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export function createWidgetToken(sessionId: string): string {
  return seal({ sid: sessionId, exp: Date.now() + WIDGET_TTL_MS });
}

export const widgetCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: Math.floor(WIDGET_TTL_MS / 1000),
};

export function readWidgetSessionId(request: NextRequest): string | null {
  const token = request.headers.get(WIDGET_TOKEN_HEADER) || request.cookies.get(WIDGET_COOKIE)?.value;
  const payload = unseal<{ sid?: string }>(token);
  return payload?.sid ?? null;
}
