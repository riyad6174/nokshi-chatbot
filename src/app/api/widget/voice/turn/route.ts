import type { NextRequest } from "next/server";
import { logger } from "@/lib/logging/logger";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { jsonError, jsonOk, sseEvent, sseHeaders, validationError } from "@/lib/http";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { widgetVoiceTurnSchema } from "@/lib/validation/schemas";
import { appendMessage, getConversationForSession, toChatMessage } from "@/modules/conversations/conversation.service";
import { getSessionContext, resolveLocaleForStore, touchSession } from "@/modules/conversations/session.service";
import { claimUploads, MAX_UPLOAD_BYTES, saveUpload, uploadKind } from "@/modules/conversations/upload.service";
import { runConversationTurn } from "@/modules/conversations/turn.service";
import { trackEvent } from "@/modules/customers/events.service";
import { getSpeechProvider } from "@/modules/speech/config";
import { voiceAssistantEnabled } from "@/modules/speech/greeting";
import { createVoiceReply } from "@/modules/speech/voice-reply";
import { isLikelyEcho } from "@/modules/speech/echo";
import { synthesizeCached } from "@/modules/speech/greeting";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

/** Below this recognition confidence (Azure, 0..1) the assistant asks the customer to repeat. */
const UNCLEAR_CONFIDENCE = 0.45;
const ASK_AGAIN = {
  bn: "দুঃখিত, ঠিক বুঝতে পারিনি। আরেকবার বলবেন?",
  en: "Sorry, I didn't catch that. Could you say it again?",
} as const;
export const dynamic = "force-dynamic";

// One spoken turn of the hands-free voice assistant. The customer's words arrive as recorded audio
// (server speech-to-text) or as a browser transcript. The reply streams like /api/widget/message,
// plus: voice.sentence {seq, text, lang, audio, mime} · voice.done {sentences}.
// Nothing intelligible heard: 422 no_speech (the client just keeps listening).

export async function POST(request: NextRequest) {
  const ipRate = checkRateLimit(`voice:ip:${getClientIp(request)}`, 60, 60_000);
  if (!ipRate.allowed) return jsonError(429, "rate_limited", "Too many messages. Please wait a moment and try again.");

  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session before talking to the assistant.");

  const sessionRate = checkRateLimit(`voice:session:${sessionId}`, 20, 60_000);
  if (!sessionRate.allowed) return jsonError(429, "rate_limited", "Too many messages. Please wait a moment and try again.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "invalid_request", "Send the voice turn as multipart form data.");
  }
  const parsed = widgetVoiceTurnSchema.safeParse({
    conversationId: form.get("conversationId") ?? "",
    lang: form.get("lang") ?? undefined,
    transcript: form.get("transcript") ?? "",
    durationMs: form.get("durationMs") ?? undefined,
    assistantSaid: form.get("assistantSaid") ?? "",
  });
  if (!parsed.success) return validationError(parsed.error);

  const audioField = form.get("audio");
  const audio = audioField instanceof File && audioField.size > 0 ? audioField : null;
  if (audio && (audio.size > MAX_UPLOAD_BYTES || uploadKind(audio.type) !== "audio")) {
    return jsonError(400, "invalid_audio", "That recording couldn't be used. Please try again.");
  }

  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired. Please reload the chat.");
  if (!voiceAssistantEnabled(context.store)) {
    return jsonError(403, "voice_disabled", "The voice assistant is turned off for this store.");
  }

  const conversation = await getConversationForSession(parsed.data.conversationId, context.sessionId, context.storeId);
  if (!conversation) return jsonError(403, "conversation_forbidden", "That conversation does not belong to this session.");
  if (conversation.status === "closed") {
    return jsonError(409, "conversation_closed", "This conversation was closed. Starting a new one.");
  }

  const lang = parsed.data.lang;
  const provider = getSpeechProvider();
  let userText = parsed.data.transcript;
  let confidence: number | undefined;
  if (provider && audio) {
    try {
      const result = await provider.transcribe({
        audio: Buffer.from(await audio.arrayBuffer()),
        mime: audio.type,
        lang,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
      });
      userText = result.text || userText;
      confidence = result.confidence;
    } catch (error) {
      logger.warn("voice.stt_failed", { error: error instanceof Error ? error.message : String(error) });
      if (!userText) return jsonError(502, "speech_unavailable", "I couldn't hear that clearly. Please try again.");
    }
  }
  userText = userText.trim().slice(0, 2000);
  // The customer clearly talked (a second or more) but it couldn't be understood: ask again,
  // out loud, instead of staying silent or guessing. Short sounds are just noise.
  const spokeForAWhile = (parsed.data.durationMs ?? 0) >= 1000;
  const unclear = !userText || (confidence !== undefined && confidence < UNCLEAR_CONFIDENCE);
  if (!userText && !spokeForAWhile) return jsonError(422, "no_speech", "Nothing was heard.");

  // The assistant hearing itself through the speakers: ignore it, keep listening.
  const recentReplies = await prisma.message.findMany({
    where: { conversationId: conversation.id, role: "assistant", createdAt: { gte: new Date(Date.now() - 30_000) } },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: { content: true },
  });
  const assistantSaid = [parsed.data.assistantSaid, ...recentReplies.map((reply) => reply.content)].join(" ");
  if (userText && isLikelyEcho(userText, assistantSaid)) {
    return jsonError(422, "echo", "That was the assistant's own voice.");
  }
  if (unclear) {
    if (!spokeForAWhile) return jsonError(422, "no_speech", "Nothing was heard clearly.");
    const text = ASK_AGAIN[lang];
    const speech = await synthesizeCached(text, lang);
    return jsonOk(
      { error: { code: "unclear", message: text }, speech: { text, lang, audio: speech, mime: speech ? "audio/mpeg" : null } },
      { status: 422 },
    );
  }

  const locale = resolveLocaleForStore(context.store, lang);
  await touchSession(context.sessionId, locale !== context.locale ? locale : undefined);

  // Keep the recording so a team member can listen to it from the inbox.
  let attachments: Awaited<ReturnType<typeof claimUploads>> = [];
  if (audio) {
    try {
      const upload = await saveUpload({ storeId: context.storeId, sessionId: context.sessionId, file: audio });
      attachments = await claimUploads({
        storeId: context.storeId,
        sessionId: context.sessionId,
        conversationId: conversation.id,
        items: [{ uploadId: upload.id, transcript: userText, durationMs: parsed.data.durationMs }],
      });
    } catch (error) {
      logger.warn("voice.audio_not_saved", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  const userMessage = await appendMessage({ conversationId: conversation.id, role: "user", content: userText, attachments });
  await trackEvent({
    storeId: context.storeId,
    sessionId: context.sessionId,
    visitorId: context.visitorId,
    type: "voice_turn",
    meta: { lang, durationMs: parsed.data.durationMs ?? null, speech: provider ? provider.id : "browser" },
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        } catch {
          // The customer interrupted and the client closed the stream; keep finishing server-side.
          closed = true;
        }
      };
      const reply = createVoiceReply({ provider, fallbackLang: lang, send, signal: request.signal });

      try {
        send("message.started", { userMessage: toChatMessage(userMessage), transcript: userText });
        await runConversationTurn({
          context: { ...context, locale },
          conversation,
          userText,
          attachments,
          channel: "voice",
          signal: request.signal,
          send: (event, data) => {
            send(event, data);
            if (event === "message.delta") reply.push((data as { text: string }).text);
            if (event === "message.error") reply.push(`\n${(data as { message: string }).message}\n`);
          },
        });
        await reply.finish();
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // The client may already have closed the stream.
        }
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
}
