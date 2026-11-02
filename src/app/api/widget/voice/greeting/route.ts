import type { NextRequest } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { jsonError, jsonOk, validationError } from "@/lib/http";
import { speechMode } from "@/modules/speech/config";
import { greetingText, knownCustomerOpener, synthesizeCached, voiceAssistantEnabled } from "@/modules/speech/greeting";
import { savedDetailsForVisitor } from "@/modules/customers/profile.service";
import { getStoreByWidgetKey, parseJsonArray } from "@/modules/stores/store.service";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { buildReminder, type Reminder } from "@/modules/conversations/reminder.service";
import { getSessionContext } from "@/modules/conversations/session.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  widgetKey: z.string().min(1).max(200),
  lang: z.enum(["en", "bn"]).default("bn"),
  // welcome: the line played when a visitor lands · start: the opener when voice mode turns on
  kind: z.enum(["welcome", "start"]).default("welcome"),
});

// Store-configured lines only (never caller-supplied text), so this can't be used as a free TTS service.
export async function GET(request: NextRequest) {
  const rate = checkRateLimit(`voice-greeting:${getClientIp(request)}`, 30, 60_000);
  if (!rate.allowed) return jsonError(429, "rate_limited", "Too many requests. Please try again shortly.");

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return validationError(parsed.error);

  const store = await getStoreByWidgetKey(parsed.data.widgetKey);
  if (!store) return jsonError(404, "widget_not_found", "This chat widget is not configured.");

  const enabled =
    voiceAssistantEnabled(store) && (parsed.data.kind === "start" || (store.settings?.welcomeVoiceEnabled ?? true));
  if (!enabled) return jsonOk({ enabled: false });

  // Bangla is the default voice; stores that don't support Bangla greet in English.
  const lang = parsed.data.lang === "bn" && !parseJsonArray(store.supportedLocales).some((locale) => locale.startsWith("bn")) ? "en" : parsed.data.lang;
  // A returning visitor (their chat session cookie) is reminded of what they left unfinished.
  // The voice opener asks a new customer's name, and greets a known one by name.
  let reminder: Reminder | null = null;
  let opener: string | null = null;
  const sessionId = readWidgetSessionId(request);
  const context = sessionId ? await getSessionContext(sessionId) : null;
  if (context && context.storeId === store.id) {
    if (parsed.data.kind === "welcome") {
      reminder = await buildReminder(context, lang).catch(() => null);
    } else {
      const saved = await savedDetailsForVisitor(context.storeId, context.visitorId).catch(() => null);
      if (saved?.name) opener = knownCustomerOpener(saved.name, lang);
    }
  }
  const text = reminder?.text ?? opener ?? greetingText(store, parsed.data.kind, lang);
  const audio = await synthesizeCached(text, lang);
  return jsonOk({
    enabled: true,
    text,
    lang,
    reminder: reminder ? { kind: reminder.kind, product: reminder.product } : null,
    audio,
    mime: audio ? "audio/mpeg" : null,
    assistantName: store.settings?.assistantName || "Shopping assistant",
    speech: speechMode(),
  });
}
