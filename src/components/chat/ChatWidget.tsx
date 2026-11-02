"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PendingAttachment } from "@/components/chat/ChatComposer";
import { ChatPanel, type ChatUiError } from "@/components/chat/ChatPanel";
import { useVoiceRecorder } from "@/components/chat/useVoiceRecorder";
import { AssistantOrb, type OrbState } from "@/components/chat/AssistantOrb";
import { VoiceControlCard } from "@/components/chat/VoiceControlCard";
import { WelcomeBubble } from "@/components/chat/WelcomeBubble";
import {
  useVoiceSession,
  voiceSupport,
  type SpokenSentence,
  type Utterance,
  type VoiceLang,
  type VoiceTurn,
} from "@/components/chat/useVoiceSession";
import { streamSse } from "@/lib/client/sse";
import type {
  CartPayload,
  ChatMessage,
  ChatPart,
  ConversationMode,
  CustomerDetailsData,
  WidgetSessionResponse,
} from "@/types/chat";

const WIDGET_KEY = process.env.NEXT_PUBLIC_WIDGET_KEY || "demo-widget-key";

type ChatWidgetProps = {
  /** Set on product pages: the chat greets with an overview of this product. */
  productId?: string;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return current;
  const known = new Set(current.map((message) => message.id));
  const fresh = incoming.filter((message) => !known.has(message.id));
  return fresh.length === 0 ? current : [...current, ...fresh];
}

const VISITOR_KEY = "nokshi:visitor-id";

// The visitor id links a returning shopper to their saved details. Storage may be unavailable
// (private mode); the chat still works, the shopper just isn't recognized next time.
function readVisitorId(): string | null {
  try {
    return window.localStorage.getItem(VISITOR_KEY);
  } catch {
    return null;
  }
}

function storeVisitorId(visitorId: string) {
  try {
    window.localStorage.setItem(VISITOR_KEY, visitorId);
  } catch {
    // Not remembered; see readVisitorId.
  }
}

function kindOf(file: File): "image" | "file" {
  return file.type.startsWith("image/") ? "image" : "file";
}

export function ChatWidget({ productId }: ChatWidgetProps = {}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<WidgetSessionResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cart, setCart] = useState<CartPayload | null>(null);
  const [mode, setMode] = useState<ConversationMode>("bot");
  const [agentName, setAgentName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ChatUiError | null>(null);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [unread, setUnread] = useState(0);

  const sessionRef = useRef<WidgetSessionResponse | null>(null);
  const loadingRef = useRef(false);
  const sendingRef = useRef(false);
  const inflightRef = useRef(0);
  const checkoutBusyRef = useRef(false);
  const lastSeenRef = useRef<string | null>(null);
  const openRef = useRef(open);
  const greetedProductRef = useRef<string | undefined>(undefined);
  const voice = useVoiceRecorder();

  openRef.current = open;

  const noteLatest = useCallback((list: ChatMessage[]) => {
    const latest = list[list.length - 1];
    if (latest && !latest.id.startsWith("pending-") && !latest.id.startsWith("user-")) lastSeenRef.current = latest.createdAt;
  }, []);

  const initSession = useCallback(async (): Promise<WidgetSessionResponse | null> => {
    if (loadingRef.current) return sessionRef.current;
    loadingRef.current = true;
    setLoading(!sessionRef.current);
    setSessionError(null);
    try {
      const locale = typeof navigator !== "undefined" ? (navigator.language || "en").split("-")[0] : undefined;
      const response = await fetch("/api/widget/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgetKey: WIDGET_KEY, visitorId: readVisitorId(), locale, productId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message || "Could not start the chat.");
      const data = body as WidgetSessionResponse;
      storeVisitorId(data.visitorId);
      sessionRef.current = data;
      greetedProductRef.current = productId;
      setSession(data);
      setMessages(data.messages);
      noteLatest(data.messages);
      setCart(data.cart);
      setMode(data.conversationMode);
      return data;
    } catch (caught) {
      setSessionError(errorMessage(caught, "Could not start the chat."));
      return null;
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [noteLatest, productId]);

  useEffect(() => {
    if (open && !sessionRef.current && !loadingRef.current && !sessionError) void initSession();
    if (open) setUnread(0);
  }, [open, initSession, sessionError]);

  // Moving to another product page while the chat is open: re-sync so the product greeting appears.
  useEffect(() => {
    if (open && sessionRef.current && productId && greetedProductRef.current !== productId) void initSession();
  }, [open, productId, initSession]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt?: string }>).detail;
      setOpen(true);
      if (detail?.prompt) setDraft(detail.prompt);
    };
    window.addEventListener("nokshi:open-chat", onOpen);
    return () => window.removeEventListener("nokshi:open-chat", onOpen);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Agent replies and order/handoff events arrive by polling: fast while a human is involved,
  // slow otherwise (order status updates), and only in the background when the chat is closed.
  useEffect(() => {
    if (!session) return;
    const human = mode === "human" || mode === "waiting_human";
    const interval = open ? (human ? 3000 : 15000) : human ? 10000 : 0;
    if (!interval) return;
    let cancelled = false;
    const poll = async () => {
      if (sendingRef.current || document.visibilityState !== "visible") return;
      const params = new URLSearchParams({ conversationId: session.conversationId });
      if (lastSeenRef.current) params.set("after", lastSeenRef.current);
      try {
        const response = await fetch(`/api/widget/messages?${params}`);
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { messages: ChatMessage[]; mode: ConversationMode; agentName: string | null };
        setMode(body.mode);
        setAgentName(body.agentName);
        if (body.messages.length > 0) {
          setMessages((current) => {
            const merged = mergeMessages(current, body.messages);
            noteLatest(merged);
            return merged;
          });
          const fromOthers = body.messages.filter((message) => message.role === "agent" || message.role === "event").length;
          if (!openRef.current && fromOthers > 0) setUnread((count) => count + fromOthers);
          for (const message of body.messages) {
            const cartPart = message.parts.find((part) => part.type === "cart_summary");
            if (cartPart && cartPart.type === "cart_summary") setCart(cartPart.cart);
          }
        }
      } catch {
        // Try again on the next tick.
      }
    };
    const timer = window.setInterval(poll, interval);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session, mode, open, noteLatest]);

  /**
   * Posts one customer turn and renders the streamed reply. Shared by typed messages and voice turns.
   * `optimisticUser` shows the customer's message immediately; voice turns pass null and get it
   * (with the transcript) from message.started.
   */
  const deliverTurn = useCallback(
    async (input: {
      optimisticUser: ChatMessage | null;
      retryText?: string;
      post: (active: WidgetSessionResponse) => Promise<Response>;
      onEvent?: (event: string, data: unknown) => void;
      /** A voice turn the server didn't accept (422): nothing heard, echo, or "say it again". */
      onRejected?: (body: unknown) => void;
      signal?: AbortSignal;
    }) => {
      let activeSession = sessionRef.current ?? (await initSession());
      if (!activeSession) return;

      inflightRef.current += 1;
      sendingRef.current = true;
      setSending(true);
      setError(null);

      const timestamp = Date.now();
      const pendingId = `pending-${timestamp}-${inflightRef.current}`;
      const userTempId = input.optimisticUser?.id ?? null;
      const pendingMessage: ChatMessage = { id: pendingId, role: "assistant", parts: [], createdAt: new Date(timestamp).toISOString() };
      setMessages((previous) => [
        ...previous,
        ...(input.optimisticUser ? [input.optimisticUser] : []),
        ...(mode === "bot" ? [pendingMessage] : []),
      ]);

      const appendText = (chunk: string) => {
        setMessages((previous) =>
          previous.map((message) => {
            if (message.id !== pendingId) return message;
            const parts = [...message.parts];
            const last = parts[parts.length - 1];
            if (last?.type === "text") parts[parts.length - 1] = { type: "text", text: last.text + chunk };
            else parts.push({ type: "text", text: chunk });
            return { ...message, parts };
          }),
        );
      };
      const addPart = (part: ChatPart) => {
        setMessages((previous) =>
          previous.map((message) => (message.id === pendingId ? { ...message, parts: [...message.parts, part] } : message)),
        );
      };
      const dropEmptyPending = () =>
        setMessages((previous) => previous.filter((message) => message.id !== pendingId || message.parts.length > 0));

      try {
        let response = await input.post(activeSession);
        if (response.status === 401 || response.status === 409) {
          // Session expired or the conversation was closed by the team: start fresh and resend once.
          sessionRef.current = null;
          activeSession = await initSession();
          if (!activeSession) throw new Error("Your chat session expired. Please try again.");
          response = await input.post(activeSession);
        }
        if (response.status === 422) {
          // Voice turn where nothing intelligible was heard.
          dropEmptyPending();
          input.onRejected?.(await response.json().catch(() => null));
          return;
        }
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error?.message || "The message could not be sent. Please try again.");
        }

        await streamSse(response, (event, data) => {
          input.onEvent?.(event, data);
          if (event === "message.started") {
            const real = (data as { userMessage?: ChatMessage })?.userMessage;
            if (real) {
              setMessages((previous) => {
                if (userTempId && previous.some((message) => message.id === userTempId)) {
                  return previous.map((message) =>
                    message.id === userTempId ? { ...real, attachments: real.attachments ?? message.attachments } : message,
                  );
                }
                // Voice turn: the customer's words arrive with the reply; show them above it.
                const at = previous.findIndex((message) => message.id === pendingId);
                return at === -1 ? [...previous, real] : [...previous.slice(0, at), real, ...previous.slice(at)];
              });
            }
          } else if (event === "message.delta") {
            const chunk = (data as { text?: string })?.text;
            if (chunk) appendText(chunk);
          } else if (event === "ui.part") {
            const part = (data as { part?: ChatPart })?.part;
            if (part) addPart(part);
          } else if (event === "ui.cart") {
            const nextCart = (data as { cart?: CartPayload })?.cart;
            if (nextCart) setCart(nextCart);
          } else if (event === "message.event") {
            const message = (data as { message?: ChatMessage })?.message;
            if (message) setMessages((previous) => mergeMessages(previous, [message]));
            // An order was placed during this turn: the cart was checked out.
            if (message?.parts.some((part) => part.type === "order_status")) {
              void fetch("/api/widget/cart")
                .then((cartResponse) => cartResponse.json())
                .then((body: { cart?: CartPayload }) => body?.cart && setCart(body.cart))
                .catch(() => undefined);
            }
          } else if (event === "conversation.mode") {
            const next = (data as { mode?: ConversationMode })?.mode;
            if (next) setMode(next);
          } else if (event === "message.completed") {
            const id = (data as { messageId?: string | null })?.messageId;
            setMessages((previous) => {
              const updated = id
                ? previous.map((message) => (message.id === pendingId ? { ...message, id } : message))
                : previous.filter((message) => message.id !== pendingId || message.parts.length > 0);
              noteLatest(updated);
              return updated;
            });
          } else if (event === "message.error") {
            throw new Error((data as { message?: string })?.message || "The reply failed.");
          }
        });
        // Drop an empty placeholder (e.g. when a human is handling the chat).
        dropEmptyPending();
      } catch (caught) {
        if (input.signal?.aborted) {
          // The customer talked over the assistant: keep what was already said, start the next turn.
          dropEmptyPending();
          return;
        }
        setError({ message: errorMessage(caught, "The reply failed. Please try again."), retryText: input.retryText });
        setMessages((previous) =>
          previous.map((message) =>
            message.id === pendingId && message.parts.length === 0
              ? { ...message, parts: [{ type: "text", text: "I couldn't finish that reply. Please try again." }] }
              : message,
          ),
        );
      } finally {
        inflightRef.current -= 1;
        if (inflightRef.current === 0) {
          sendingRef.current = false;
          setSending(false);
        }
      }
    },
    [initSession, mode, noteLatest],
  );

  const sendMessage = useCallback(
    async (raw: string, extraAttachments: Array<{ uploadId: string; transcript?: string; durationMs?: number }> = []) => {
      const text = raw.trim();
      const ready = pending.filter((item) => item.status === "ready" && item.uploadId);
      const attachments = [...ready.map((item) => ({ uploadId: item.uploadId! })), ...extraAttachments];
      if ((!text && attachments.length === 0) || sendingRef.current) return;

      setDraft("");
      setPending((current) => current.filter((item) => item.status === "error"));

      const timestamp = Date.now();
      const userMessage: ChatMessage = {
        id: `user-${timestamp}`,
        role: "user",
        parts: text ? [{ type: "text", text }] : [],
        attachments: ready.map((item) => ({
          uploadId: item.uploadId!,
          name: item.name,
          mime: "",
          size: 0,
          kind: item.kind,
          url: item.previewUrl ?? `/api/widget/uploads/${item.uploadId}`,
        })),
        createdAt: new Date(timestamp).toISOString(),
      };

      await deliverTurn({
        optimisticUser: userMessage,
        retryText: text || undefined,
        post: (active) =>
          fetch("/api/widget/message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId: active.conversationId, message: text, locale: active.locale, attachments }),
          }),
      });
    },
    [deliverTurn, pending],
  );

  const voiceLangRef = useRef<VoiceLang>("bn");
  const setVoiceLangRef = useRef<(lang: VoiceLang) => void>(() => undefined);

  const sendVoiceTurn = useCallback(
    async (utterance: Utterance, turn: VoiceTurn) => {
      const spokenLangs: Record<VoiceLang, number> = { en: 0, bn: 0 };
      await deliverTurn({
        optimisticUser: null,
        signal: turn.signal,
        post: (active) => {
          const form = new FormData();
          form.append("conversationId", active.conversationId);
          form.append("lang", voiceLangRef.current);
          form.append("durationMs", String(Math.round(utterance.durationMs)));
          if (utterance.assistantSaid) form.append("assistantSaid", utterance.assistantSaid.slice(-1000));
          if (utterance.transcript) form.append("transcript", utterance.transcript);
          if (utterance.audio) form.append("audio", utterance.audio, "utterance.wav");
          return fetch("/api/widget/voice/turn", { method: "POST", body: form, signal: turn.signal });
        },
        onRejected: (body) => {
          const speech = (body as { speech?: SpokenSentence } | null)?.speech;
          if (speech?.text) turn.speak(speech);
        },
        onEvent: (event, data) => {
          if (event !== "voice.sentence") return;
          const sentence = data as SpokenSentence;
          spokenLangs[sentence.lang] += sentence.text.length;
          turn.speak(sentence);
        },
      });
      const replyLang: VoiceLang = spokenLangs.bn > spokenLangs.en ? "bn" : "en";
      if (!turn.signal.aborted && spokenLangs[replyLang] > 0 && replyLang !== voiceLangRef.current) {
        setVoiceLangRef.current(replyLang);
      }
    },
    [deliverTurn],
  );

  const voiceSession = useVoiceSession({ onUtterance: sendVoiceTurn });
  voiceLangRef.current = voiceSession.lang;
  setVoiceLangRef.current = voiceSession.setLang;
  const [voiceCaps, setVoiceCaps] = useState({ server: false, browser: false });

  useEffect(() => setVoiceCaps(voiceSupport()), []);

  const voiceConfig = session?.settings.voiceAssistant;
  const voiceSpeech: "server" | "browser" | null = !voiceConfig?.enabled
    ? null
    : voiceConfig.speech === "server" && voiceCaps.server
      ? "server"
      : voiceCaps.browser
        ? "browser"
        : null;

  const startVoiceAssistant = useCallback(async () => {
    // Inside the click: unlock audio before anything is awaited.
    voiceSession.prime();
    setOpen(true);
    const active = sessionRef.current ?? (await initSession());
    if (!active) return;
    const caps = voiceSupport();
    const configured = active.settings.voiceAssistant;
    const speech = configured.speech === "server" && caps.server ? "server" : caps.browser ? "browser" : null;
    if (!configured.enabled || !speech) {
      setError({ message: "Voice isn't supported in this browser. Try Chrome or Edge, or keep chatting by text." });
      return;
    }
    const lang: VoiceLang = active.store.supportedLocales.some((locale) => locale.startsWith("bn")) ? "bn" : "en";
    const started = await voiceSession.start({ speech, lang, maxSessionMinutes: configured.maxSessionMinutes });
    if (!started) return;
    try {
      const params = new URLSearchParams({ widgetKey: WIDGET_KEY, lang, kind: "start" });
      const response = await fetch(`/api/widget/voice/greeting?${params}`);
      const body = await response.json().catch(() => null);
      if (response.ok && body?.enabled) voiceSession.say({ text: body.text, lang, audio: body.audio, mime: body.mime });
    } catch {
      // The opener is optional; the assistant is already listening.
    }
  }, [initSession, voiceSession]);

  useEffect(() => {
    const onStartVoice = () => void startVoiceAssistant();
    window.addEventListener("nokshi:start-voice", onStartVoice);
    return () => window.removeEventListener("nokshi:start-voice", onStartVoice);
  }, [startVoiceAssistant]);

  useEffect(() => {
    if (voiceSession.error) setError({ message: voiceSession.error });
  }, [voiceSession.error]);

  const [confirmingOrder, setConfirmingOrder] = useState(false);

  const confirmOrder = useCallback(
    async (confirmationId: string) => {
      if (confirmingOrder) return;
      setConfirmingOrder(true);
      setError(null);
      voiceSession.interrupt();
      try {
        const response = await fetch("/api/widget/orders/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmationId, voice: voiceSession.active, lang: voiceSession.lang }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error?.message || "The order could not be placed. Nothing was charged.");
        const fresh = (body.messages ?? []) as ChatMessage[];
        setMessages((previous) => {
          const merged = mergeMessages(previous, fresh);
          noteLatest(merged);
          return merged;
        });
        if (body.cart) setCart(body.cart as CartPayload);
        if (body.speech && voiceSession.active) voiceSession.say(body.speech as SpokenSentence);
      } catch (caught) {
        setError({ message: errorMessage(caught, "The order could not be placed. Nothing was charged.") });
      } finally {
        setConfirmingOrder(false);
      }
    },
    [confirmingOrder, noteLatest, voiceSession],
  );

  const [welcomeSpeaking, setWelcomeSpeaking] = useState(false);

  // One animated orb at a time: the launcher while the chat is closed, the header orb (only while
  // talking) once it's open.
  const talking = voiceSession.active && ["hearing", "thinking", "speaking", "listening"].includes(voiceSession.phase);
  const headerOrbState: OrbState = talking ? (voiceSession.phase as OrbState) : "still";
  const launcherOrbState: OrbState = welcomeSpeaking ? "speaking" : "idle";

  // Typed text (composer, chips, forms) during voice mode goes through the voice turn so the answer is spoken.
  const sendTyped = useCallback(
    (text: string) => {
      if (voiceSession.active && text.trim() && mode === "bot") void voiceSession.submitText(text.trim());
      else void sendMessage(text);
    },
    [mode, sendMessage, voiceSession],
  );

  // Once an order is placed, voice mode ends after the confirmation is spoken; the chat stays open
  // with the success card. Orders already in the history when the chat loads don't count.
  const lastPlacedRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const placed = [...messages]
      .reverse()
      .find((message) => message.role === "event" && message.parts.some((part) => part.type === "order_status" && part.orders.some((order) => order.status === "placed")));
    if (lastPlacedRef.current === undefined) {
      if (messages.length > 0) lastPlacedRef.current = placed?.id ?? null;
      return;
    }
    if (placed && placed.id !== lastPlacedRef.current) {
      lastPlacedRef.current = placed.id;
      if (voiceSession.active) voiceSession.finishAfterSpeech();
    }
  }, [messages, voiceSession]);

  const closePanel = useCallback(() => {
    if (voiceSession.active) voiceSession.stop();
    setOpen(false);
  }, [voiceSession]);

  const uploadFile = useCallback(async (file: Blob, name: string): Promise<{ uploadId: string } | { error: string }> => {
    const form = new FormData();
    form.append("file", file, name);
    try {
      const response = await fetch("/api/widget/uploads", { method: "POST", body: form });
      const body = await response.json().catch(() => null);
      if (!response.ok) return { error: body?.error?.message || "Upload failed." };
      return { uploadId: body.upload.uploadId as string };
    } catch {
      return { error: "Upload failed. Check your connection." };
    }
  }, []);

  const pickFiles = useCallback(
    async (files: FileList) => {
      if (!sessionRef.current && !(await initSession())) return;
      const selected = Array.from(files).slice(0, Math.max(0, 4 - pending.length));
      for (const file of selected) {
        const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const tooLarge = file.size > 5 * 1024 * 1024;
        const item: PendingAttachment = {
          localId,
          name: file.name,
          kind: kindOf(file),
          previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
          status: tooLarge ? "error" : "uploading",
          error: tooLarge ? "Over 5 MB" : undefined,
        };
        setPending((current) => [...current, item]);
        if (tooLarge) continue;
        const result = await uploadFile(file, file.name);
        setPending((current) =>
          current.map((entry) =>
            entry.localId !== localId
              ? entry
              : "uploadId" in result
                ? { ...entry, status: "ready", uploadId: result.uploadId }
                : { ...entry, status: "error", error: result.error },
          ),
        );
      }
    },
    [initSession, pending.length, uploadFile],
  );

  const startVoice = useCallback(async () => {
    const active = sessionRef.current ?? (await initSession());
    if (!active) return;
    const lang = active.locale.startsWith("bn") ? "bn-BD" : navigator.language || "en-US";
    await voice.start(lang);
  }, [initSession, voice]);

  const stopVoice = useCallback(async () => {
    const note = await voice.stop();
    if (!note) return;
    const extension = note.mime.includes("mp4") ? "m4a" : note.mime.includes("ogg") ? "ogg" : "webm";
    setToast("Sending voice message…");
    const result = await uploadFile(note.blob, `voice-message.${extension}`);
    if ("error" in result) {
      setError({ message: result.error });
      return;
    }
    await sendMessage("", [{ uploadId: result.uploadId, transcript: note.transcript || undefined, durationMs: note.durationMs }]);
  }, [sendMessage, uploadFile, voice]);

  useEffect(() => {
    if (voice.error) setError({ message: voice.error });
  }, [voice.error]);

  const refreshCart = useCallback(async () => {
    try {
      const response = await fetch("/api/widget/cart");
      const body = await response.json().catch(() => null);
      if (response.ok && body?.cart) setCart(body.cart as CartPayload);
    } catch {
      // Keep the current cart UI; the next action will surface the error.
    }
  }, []);

  const addToCart = useCallback(async (productIdToAdd: string, variantId: string | null) => {
    if (!sessionRef.current) return;
    setBusyProductId(productIdToAdd);
    setError(null);
    try {
      const response = await fetch("/api/widget/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: productIdToAdd, variantId, quantity: 1 }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message || "That item could not be added.");
      setCart(body.cart as CartPayload);
      setToast("Added to cart ✓");
    } catch (caught) {
      setError({ message: errorMessage(caught, "That item could not be added.") });
    } finally {
      setBusyProductId(null);
    }
  }, []);

  const removeCartItem = useCallback(async (itemId: string) => {
    if (!sessionRef.current) return;
    setBusyItemId(itemId);
    setError(null);
    try {
      const response = await fetch(`/api/widget/cart/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message || "That item could not be removed.");
      setCart(body.cart as CartPayload);
    } catch (caught) {
      setError({ message: errorMessage(caught, "That item could not be removed.") });
    } finally {
      setBusyItemId(null);
    }
  }, []);

  const updateQuantity = useCallback(
    async (itemId: string, quantity: number) => {
      if (!sessionRef.current) return;
      if (quantity < 1) {
        await removeCartItem(itemId);
        return;
      }
      setBusyItemId(itemId);
      setError(null);
      try {
        const response = await fetch(`/api/widget/cart/items/${encodeURIComponent(itemId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error?.message || "The quantity could not be updated.");
        setCart(body.cart as CartPayload);
      } catch (caught) {
        setError({ message: errorMessage(caught, "The quantity could not be updated.") });
      } finally {
        setBusyItemId(null);
      }
    },
    [removeCartItem],
  );

  const startCheckout = useCallback(
    async (details?: CustomerDetailsData) => {
      if (checkoutBusyRef.current) return;
      if (!cart || cart.items.length === 0) {
        setError({ message: "Your cart is empty. Add an item before checking out." });
        return;
      }
      checkoutBusyRef.current = true;
      setCheckoutBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/widget/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true, ...(details ? { customer: details } : {}) }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status === 409) await refreshCart();
          throw new Error(body?.error?.message || "Checkout could not be prepared. Nothing was charged.");
        }
        const url = new URL(body.checkoutUrl as string, window.location.href);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("The checkout link was not valid. Nothing was charged.");
        window.location.assign(url.toString());
      } catch (caught) {
        setError({ message: errorMessage(caught, "Checkout could not be prepared. Nothing was charged.") });
        checkoutBusyRef.current = false;
        setCheckoutBusy(false);
      }
    },
    [cart, refreshCart],
  );

  const accent = session?.settings.theme.accent || "#0f766e";
  const position = session?.settings.theme.position === "left" ? "left" : "right";

  return (
    <>
      <WelcomeBubble
        widgetKey={WIDGET_KEY}
        suppressed={open || voiceSession.active}
        accent={accent}
        position={position}
        onSpeakingChange={setWelcomeSpeaking}
        onTalk={() => void startVoiceAssistant()}
        onChat={() => setOpen(true)}
      />
      <ChatPanel
        open={open}
        onClose={closePanel}
        session={session}
        mode={mode}
        agentName={agentName}
        messages={messages}
        cart={cart}
        loading={loading}
        sessionError={sessionError}
        sending={sending}
        error={error}
        accent={accent}
        position={position}
        draft={draft}
        setDraft={setDraft}
        toast={toast}
        busyProductId={busyProductId}
        busyItemId={busyItemId}
        checkoutBusy={checkoutBusy}
        pending={pending}
        voice={{
          supported: voice.supported.record,
          recording: voice.recording,
          elapsedMs: voice.elapsedMs,
          transcript: voice.transcript,
          onStart: () => void startVoice(),
          onStop: () => void stopVoice(),
          onCancel: voice.cancel,
        }}
        onPickFiles={(files) => void pickFiles(files)}
        onRemovePending={(localId) => setPending((current) => current.filter((item) => item.localId !== localId))}
        onSend={sendTyped}
        onRetry={() => {
          if (error?.retryText) void sendMessage(error.retryText);
        }}
        onRetrySession={() => void initSession()}
        onDismissError={() => {
          setError(null);
          voice.clearError();
        }}
        onAdd={addToCart}
        onUpdate={updateQuantity}
        onRemove={removeCartItem}
        onCheckout={(details) => void startCheckout(details)}
        orbState={headerOrbState}
        confirmingOrder={confirmingOrder}
        onConfirmOrder={(confirmationId) => void confirmOrder(confirmationId)}
        voiceAssistant={{
          available: Boolean(voiceSpeech),
          active: voiceSession.active,
          onStart: () => void startVoiceAssistant(),
        }}
      />

      {voiceSession.active && open ? (
        <VoiceControlCard
          phase={voiceSession.phase}
          level={voiceSession.level}
          lang={voiceSession.lang}
          supportsBangla={session?.store.supportedLocales.some((locale) => locale.startsWith("bn")) ?? false}
          position={position}
          onLang={voiceSession.setLang}
          onInterrupt={voiceSession.interrupt}
          onPause={voiceSession.pause}
          onResume={voiceSession.resume}
          onStop={voiceSession.stop}
        />
      ) : null}

      <button
        type="button"
        onClick={() => {
          if (open) closePanel();
          else setOpen(true);
          setError(null);
        }}
        aria-label={open ? "Close shopping assistant" : "Open AI shopping assistant"}
        aria-expanded={open}
        className={`fixed bottom-5 z-[60] rounded-full transition duration-200 hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
          position === "left" ? "left-5" : "right-5"
        }`}
      >
        {open ? (
          // Inside the open chat only the header orb moves; the launcher is a plain close button.
          <span className="flex h-[60px] w-[60px] animate-pop items-center justify-center rounded-full bg-stone-900 text-white shadow-lg">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </span>
        ) : (
          <>
            <AssistantOrb size={60} state={launcherOrbState} accent={accent} />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-[3px] text-white drop-shadow">
              {launcherOrbState === "speaking" ? (
                [0, 1, 2, 3, 4].map((bar) => (
                  <span key={bar} className="voice-bar h-5" style={{ animationDelay: `${bar * 110}ms` }} aria-hidden="true" />
                ))
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 opacity-90" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              )}
            </span>
          </>
        )}
        {!open && unread > 0 ? (
          <span
            className="absolute -right-1 -top-1 flex h-5 min-w-5 animate-pop items-center justify-center rounded-full bg-red-500 px-1 text-[10.5px] font-bold text-white"
            aria-label={`${unread} new messages`}
          >
            {unread}
          </span>
        ) : null}
      </button>
    </>
  );
}
