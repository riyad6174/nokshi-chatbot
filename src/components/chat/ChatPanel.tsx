"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AssistantOrb, type OrbState } from "@/components/chat/AssistantOrb";
import { ChatComposer, type PendingAttachment } from "@/components/chat/ChatComposer";
import { Confetti } from "@/components/chat/Confetti";
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
  /** Hands-free voice assistant: header button to start it, and its stage while active. */
  voiceAssistant: { available: boolean; active: boolean; onStart: () => void };
  /** What the assistant is doing, for the header orb. */
  orbState: OrbState;
  /** What the assistant is doing right now ("Searching products…"), or null. */
  workingLabel?: string | null;
  confirmingOrder: boolean;
  onConfirmOrder: (confirmationId: string) => void;
  /** Proactive suggestion buttons: "No thanks" / "Stop suggestions". */
  onSuggestionAction?: (suggestionId: string, action: "dismiss" | "opt_out") => void;
  closedSuggestions?: ReadonlySet<string>;
  /** Phones and landscape phones: the chat takes the whole screen. */
  fullScreen: boolean;
  /** Controls of a running voice call, shown under the header when the chat is full screen. */
  callBar?: ReactNode;
};

function isOrderPlacedEvent(message: ChatMessage): boolean {
  return (
    message.role === "event" &&
    message.parts.some((part) => part.type === "order_status" && part.orders.some((order) => order.status === "placed"))
  );
}

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
  voiceAssistant,
  orbState,
  workingLabel,
  confirmingOrder,
  onConfirmOrder,
  onSuggestionAction,
  closedSuggestions,
  fullScreen,
  callBar,
}: ChatPanelProps) {
  const [cartOpen, setCartOpen] = useState(false);
  const [celebration, setCelebration] = useState<string | null>(null);
  const celebratedRef = useRef<string | null | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const placed = [...messages].reverse().find(isOrderPlacedEvent);
    if (celebratedRef.current === undefined) {
      if (messages.length > 0) celebratedRef.current = placed?.id ?? null;
      return;
    }
    if (placed && placed.id !== celebratedRef.current) {
      celebratedRef.current = placed.id;
      setCelebration(placed.id);
      const timer = window.setTimeout(() => setCelebration(null), 4000);
      return () => window.clearTimeout(timer);
    }
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Follow new messages only while the customer is at the bottom (or just sent something); someone
  // scrolled up to re-read a product isn't yanked down by every streamed word.
  const atBottomRef = useRef(true);
  const [newBelow, setNewBelow] = useState(false);
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = scrollRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior });
    atBottomRef.current = true;
    setNewBelow(false);
  }, []);
  const onScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    atBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    if (atBottomRef.current) setNewBelow(false);
  };
  const lastRole = messages[messages.length - 1]?.role;
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      if (atBottomRef.current || lastRole === "user") scrollToBottom();
      else setNewBelow(true);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [open, messages, sending, lastRole, scrollToBottom]);

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
          : voiceAssistant.active
            ? "Voice mode · just talk"
            : "AI shopping assistant · voice & chat";

  return (
    <section
      role="dialog"
      aria-label={`${storeName} chat`}
      className={`fixed z-50 flex flex-col overflow-hidden bg-white shadow-panel animate-panel-in ${
        fullScreen
          ? "inset-x-0 bottom-[var(--vv-bottom,0px)] top-[var(--vv-top,0px)]"
          : `bottom-24 h-[min(680px,calc(100dvh-7.5rem))] w-[400px] rounded-2xl border border-stone-200 ${
              position === "left" ? "left-6 origin-bottom-left" : "right-6 origin-bottom-right"
            }`
      }`}
    >
      <header
        className="relative flex items-center gap-3 overflow-hidden px-4 py-3 text-white"
        style={{ background: `linear-gradient(120deg, #1e1b4b 0%, #312e81 45%, ${accent} 100%)` }}
      >
        <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-fuchsia-500/20 blur-2xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-12 left-10 h-24 w-24 rounded-full bg-cyan-400/20 blur-2xl" aria-hidden="true" />
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center text-sm font-semibold">
          {withHuman ? (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur">
              {(agentName || storeName).charAt(0).toUpperCase()}
            </span>
          ) : (
            <AssistantOrb size={40} state={orbState} accent={accent} />
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
        {voiceAssistant.available && !voiceAssistant.active && mode === "bot" ? (
          <button
            type="button"
            onClick={voiceAssistant.onStart}
            className="relative flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11.5px] font-semibold text-indigo-700 shadow-md transition hover:shadow-lg active:scale-95"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
            Talk
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label={voiceAssistant.active ? "Minimize chat, the call continues" : "Close chat"}
          title={voiceAssistant.active ? "Minimize (the call continues)" : undefined}
          className={`relative rounded-lg p-1.5 text-white/80 transition hover:bg-white/10 hover:text-white touch:p-2.5 ${voiceAssistant.active ? "" : "hover:rotate-90"}`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d={voiceAssistant.active ? "m6 9 6 6 6-6" : "M18 6 6 18M6 6l12 12"} />
          </svg>
        </button>
      </header>

      {callBar}

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

      <div ref={scrollRef} onScroll={onScroll} className="chat-scroll flex-1 overflow-y-auto overscroll-contain bg-gradient-to-b from-stone-50/60 to-white px-3 py-3">
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
            confirmingOrder={confirmingOrder}
            onConfirmOrder={onConfirmOrder}
            onSuggestionAction={onSuggestionAction}
            closedSuggestions={closedSuggestions}
            voiceAvailable={voiceAssistant.available && !voiceAssistant.active && mode === "bot"}
            onStartVoice={voiceAssistant.onStart}
            voiceActive={voiceAssistant.active}
            workingLabel={workingLabel ?? null}
          />
        ) : null}
      </div>

      {celebration ? <Confetti key={celebration} /> : null}

      {newBelow ? (
        <div className="pointer-events-none relative z-10 -mt-12 flex h-12 items-start justify-center">
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="pointer-events-auto flex animate-pop items-center gap-1.5 rounded-full bg-stone-900 px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-lg touch:py-2"
          >
            New messages
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>
      ) : null}

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
        placeholder={withHuman ? "Message our team…" : voiceAssistant.active ? "Or type here…" : "Ask me anything, or tap Talk…"}
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
