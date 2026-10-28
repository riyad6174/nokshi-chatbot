"use client";

import { useEffect, useRef, useState } from "react";
import { ChatComposer, type PendingAttachment } from "@/components/chat/ChatComposer";
import { CartSummary } from "@/components/chat/CartSummary";
import { MessageList } from "@/components/chat/MessageList";
import { formatMoney } from "@/lib/client/format";
import type { CartPayload, ChatMessage, ConversationMode, CustomerDetailsData, WidgetSessionResponse } from "@/types/chat";

export type ChatUiError = {
  message: string;
  retryText?: string;
};

type ChatPanelProps = {
  open: boolean;
  onClose: () => void;
  session: WidgetSessionResponse | null;
  mode: ConversationMode;
  agentName: string | null;
  messages: ChatMessage[];
  cart: CartPayload | null;
  loading: boolean;
  sessionError: string | null;
  sending: boolean;
  error: ChatUiError | null;
  accent: string;
  position: "left" | "right";
  draft: string;
  setDraft: (value: string) => void;
  toast: string | null;
  busyProductId: string | null;
  busyItemId: string | null;
  checkoutBusy: boolean;
  pending: PendingAttachment[];
  voice: {
    supported: boolean;
    recording: boolean;
    elapsedMs: number;
    transcript: string;
    onStart: () => void;
    onStop: () => void;
    onCancel: () => void;
  };
  onPickFiles: (files: FileList) => void;
  onRemovePending: (localId: string) => void;
  onSend: (text: string) => void;
  onRetry: () => void;
  onRetrySession: () => void;
  onDismissError: () => void;
  onAdd: (productId: string, variantId: string | null) => void;
  onUpdate: (itemId: string, quantity: number) => void;
  onRemove: (itemId: string) => void;
  onCheckout: (details?: CustomerDetailsData) => void;
};

export function ChatPanel({
  open,
  onClose,
  session,
  mode,
  agentName,
  messages,
  cart,
  loading,
  sessionError,
  sending,
  error,
  accent,
  position,
  draft,
  setDraft,
  toast,
  busyProductId,
  busyItemId,
  checkoutBusy,
  pending,
  voice,
  onPickFiles,
  onRemovePending,
  onSend,
  onRetry,
  onRetrySession,
  onDismissError,
  onAdd,
  onUpdate,
  onRemove,
  onCheckout,
}: ChatPanelProps) {
  const [cartOpen, setCartOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const container = scrollRef.current;
      if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [open, messages, sending]);

  useEffect(() => {
    if (!cart || cart.items.length === 0) setCartOpen(false);
  }, [cart?.itemCount, cart]);

  if (!open) return null;

  const storeName = session?.store.name ?? "Store";
  const assistantName = session?.settings.assistantName ?? "Shopping assistant";
  const showDemoBanner = session?.settings.aiMode === "demo" && mode === "bot";
  const hasCart = Boolean(cart && cart.items.length > 0);
  const withHuman = mode === "human" || mode === "waiting_human";

  const subtitle =
    mode === "human"
      ? `${agentName || "A team member"} is here to help`
      : mode === "waiting_human"
        ? "Connecting you with our team…"
        : mode === "closed"
          ? "Conversation closed"
          : "Online · replies instantly";

  return (
    <section
      role="dialog"
      aria-label={`${storeName} chat`}
      className={`fixed inset-2 z-50 flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-panel animate-panel-in sm:inset-auto sm:bottom-24 sm:h-[min(680px,calc(100dvh-7.5rem))] sm:w-[400px] ${
        position === "left" ? "sm:left-6 origin-bottom-left" : "sm:right-6 origin-bottom-right"
      }`}
    >
      <header
        className="relative flex items-center gap-3 overflow-hidden px-4 py-3 text-white"
        style={{ background: `linear-gradient(135deg, ${accent}, ${accent}d0)` }}
      >
        <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/10" aria-hidden="true" />
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-semibold backdrop-blur">
          {withHuman ? (agentName || storeName).charAt(0).toUpperCase() : (
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4z" />
            </svg>
          )}
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
              mode === "waiting_human" ? "bg-amber-400" : mode === "closed" ? "bg-stone-300" : "bg-emerald-400"
            }`}
            aria-hidden="true"
          />
        </div>
        <div className="relative min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold leading-tight">{withHuman && agentName ? agentName : assistantName}</p>
          <p key={subtitle} className="mt-0.5 truncate text-[11px] text-white/85 animate-fade-up">
            {subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="relative rounded-lg p-1.5 text-white/80 transition hover:rotate-90 hover:bg-white/10 hover:text-white"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      {showDemoBanner ? (
        <div className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-[10.5px] leading-snug text-amber-800">
          Demo mode: replies use built-in rules over the real catalog. Connect an AI model in the dashboard for full conversations.
        </div>
      ) : null}
      {mode === "waiting_human" ? (
        <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 animate-fade-up">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-amber-400" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
          A team member will reply here shortly. You can keep typing.
        </div>
      ) : null}

      <div ref={scrollRef} className="chat-scroll flex-1 overflow-y-auto bg-gradient-to-b from-stone-50/60 to-white px-3 py-3">
        {loading ? (
          <div className="space-y-3 pt-1" aria-label="Loading chat">
            <div className="flex items-start gap-2">
              <div className="skeleton h-7 w-7 rounded-full" />
              <div className="skeleton h-16 w-3/4" />
            </div>
            <div className="flex gap-1.5 pl-9">
              <div className="skeleton h-7 w-28 rounded-full" />
              <div className="skeleton h-7 w-24 rounded-full" />
              <div className="skeleton h-7 w-20 rounded-full" />
            </div>
          </div>
        ) : sessionError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center animate-fade-up">
            <p className="text-[13px] font-medium text-stone-800">Chat is unavailable</p>
            <p className="text-[11.5px] text-stone-500">{sessionError}</p>
            <button
              type="button"
              onClick={onRetrySession}
              className="mt-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white"
              style={{ backgroundColor: accent }}
            >
              Try again
            </button>
          </div>
        ) : session ? (
          <MessageList
            messages={messages}
            welcomeMessage={session.settings.welcomeMessage}
            assistantName={assistantName}
            topics={session.settings.suggestedTopics}
            accent={accent}
            sending={sending}
            cart={cart}
            busyProductId={busyProductId}
            busyItemId={busyItemId}
            checkoutBusy={checkoutBusy}
            onAdd={onAdd}
            onUpdate={onUpdate}
            onRemove={onRemove}
            onCheckout={onCheckout}
            onSuggestion={onSend}
          />
        ) : null}
      </div>

      {toast ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center">
          <div className="animate-pop rounded-full bg-stone-900 px-3.5 py-1.5 text-[11.5px] font-medium text-white shadow-lg">{toast}</div>
        </div>
      ) : null}

      {error ? (
        <div className="mx-3 mb-1 flex items-start gap-2 rounded-lg bg-red-50 px-2.5 py-2 text-[11px] leading-snug text-red-700 animate-fade-up">
          <p className="flex-1">{error.message}</p>
          {error.retryText ? (
            <button type="button" onClick={onRetry} className="shrink-0 font-semibold underline">
              Retry
            </button>
          ) : null}
          <button type="button" onClick={onDismissError} aria-label="Dismiss error" className="shrink-0 text-red-500">
            ×
          </button>
        </div>
      ) : null}

      {hasCart && cart ? (
        <div className="border-t border-stone-200 bg-stone-50 px-3 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCartOpen((value) => !value)}
              aria-expanded={cartOpen}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11.5px] font-medium text-stone-700"
            >
              <span key={cart.itemCount} className="animate-pop">
                Cart · {cart.itemCount} {cart.itemCount === 1 ? "item" : "items"}
              </span>
              <span className="text-stone-400">·</span>
              <span className="text-stone-600">{formatMoney(cart.subtotalMinor, cart.currency)}</span>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className={`h-3 w-3 text-stone-500 transition-transform ${cartOpen ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => onCheckout()}
              disabled={checkoutBusy}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:brightness-110 active:scale-95 disabled:opacity-50"
              style={{ backgroundColor: accent }}
            >
              {checkoutBusy ? "Checking..." : "Checkout"}
            </button>
          </div>
          {cartOpen ? (
            <div className="animate-fade-up">
              <CartSummary
                cart={cart}
                accent={accent}
                busyItemId={busyItemId}
                checkoutBusy={checkoutBusy}
                onUpdate={onUpdate}
                onRemove={onRemove}
                onCheckout={() => onCheckout()}
                showCheckout={false}
                compact
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <ChatComposer
        draft={draft}
        setDraft={setDraft}
        onSend={onSend}
        disabled={!session || loading || Boolean(sessionError) || (sending && mode === "bot")}
        active={open && !loading}
        accent={accent}
        placeholder={withHuman ? "Message our team…" : "Ask about a product, delivery, or your order…"}
        attachmentsEnabled={session?.settings.attachmentsEnabled ?? false}
        voiceEnabled={session?.settings.voiceEnabled ?? false}
        voiceSupported={voice.supported}
        recording={voice.recording}
        recordingMs={voice.elapsedMs}
        liveTranscript={voice.transcript}
        pending={pending}
        onPickFiles={onPickFiles}
        onRemovePending={onRemovePending}
        onStartVoice={voice.onStart}
        onStopVoice={voice.onStop}
        onCancelVoice={voice.onCancel}
      />
    </section>
  );
}
