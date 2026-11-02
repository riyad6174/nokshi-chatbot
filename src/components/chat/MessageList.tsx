"use client";

import type { CSSProperties, ReactNode } from "react";
import { AssistantOrb } from "@/components/chat/AssistantOrb";
import { CartSummary } from "@/components/chat/CartSummary";
import {
  AttachmentView,
  ContactForm,
  DetailsForm,
  OrderConfirmationCard,
  OrderStatusCard,
  OrderSuccessCard,
  RefineChips,
} from "@/components/chat/ChatParts";
import { CheckoutButton } from "@/components/chat/CheckoutButton";
import { ProductList } from "@/components/chat/ProductList";
import type { CartPayload, ChatMessage, ChatPart, CustomerDetailsData, SuggestedTopic } from "@/types/chat";

// The assistant works by doing things (showing products, filling the cart, preparing orders), so
// those actions render as prominent, labelled cards; its words are a lighter narration around them.

type MessageListProps = {
  messages: ChatMessage[];
  welcomeMessage: string;
  assistantName: string;
  topics: SuggestedTopic[];
  accent: string;
  sending: boolean;
  cart: CartPayload | null;
  busyProductId?: string | null;
  busyItemId?: string | null;
  checkoutBusy?: boolean;
  onAdd: (productId: string, variantId: string | null) => void;
  onUpdate: (itemId: string, quantity: number) => void;
  onRemove: (itemId: string) => void;
  onCheckout: (details?: CustomerDetailsData) => void;
  onSuggestion: (text: string) => void;
  confirmingOrder?: boolean;
  onConfirmOrder: (confirmationId: string) => void;
  /** Hands-free voice is available and not running: offer it in the empty-chat hero. */
  voiceAvailable?: boolean;
  onStartVoice?: () => void;
  /** Voice mode is on: its stage already shows the orb, so the hero leaves it out. */
  voiceActive?: boolean;
};

type ActionKind = "products" | "cart" | "checkout" | "delivery" | "order" | "tracking";

const ICONS: Record<ActionKind, ReactNode> = {
  products: <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" fill="currentColor" stroke="none" />,
  cart: (
    <>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2.5 3h2.6l2.4 12h11l2-8.5H6.2" />
    </>
  ),
  checkout: <path d="M5 12h14M13 6l6 6-6 6" />,
  delivery: (
    <>
      <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </>
  ),
  order: <path d="M9 11l2 2 4-4M5 4h14v16H5z" />,
  tracking: <path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" />,
};

function actionMeta(part: ChatPart): { kind: ActionKind; label: string; detail?: string } | null {
  switch (part.type) {
    case "product_list":
      return {
        kind: "products",
        label: part.label || (part.products.length === 1 ? "Product" : "Products for you"),
        detail: part.products.length > 1 ? `${part.products.length} items · swipe` : undefined,
      };
    case "cart_summary":
      return {
        kind: "cart",
        label: part.label || "Your cart",
        detail: `${part.cart.itemCount} ${part.cart.itemCount === 1 ? "item" : "items"}`,
      };
    case "checkout_action":
      return { kind: "checkout", label: "Ready to check out" };
    case "details_form":
      return { kind: "delivery", label: "Delivery details" };
    case "order_confirmation":
      return { kind: "order", label: "Order summary", detail: "Confirm to place it" };
    case "order_status":
      return { kind: "tracking", label: part.orders.length === 1 ? "Your order" : "Your orders" };
    case "contact_form":
      return { kind: "delivery", label: "Your details", detail: "Check & send" };
    default:
      return null;
  }
}

function ActionCard({
  kind,
  label,
  detail,
  accent,
  highlight,
  children,
}: {
  kind: ActionKind;
  label: string;
  detail?: string;
  accent: string;
  highlight: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`animate-slide-in rounded-2xl border bg-white p-2.5 shadow-sm ${highlight ? "animate-action-glow" : ""}`}
      style={{ borderColor: highlight ? `${accent}66` : "#e7e5e4", "--glow": `${accent}55` } as CSSProperties}
      aria-label={label}
    >
      <header className="mb-2 flex items-center gap-2">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-lg text-white"
          style={{ background: `linear-gradient(135deg, ${accent}, #8b5cf6)` }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {ICONS[kind]}
          </svg>
        </span>
        <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-stone-900">{label}</p>
        {detail ? <span className="shrink-0 text-[10.5px] text-stone-400">{detail}</span> : null}
        {highlight ? (
          <span className="shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: accent }}>
            New
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/** Light formatting for model text: **bold** only; everything else stays plain (no HTML injection). */
function formatText(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((chunk, index) =>
    chunk.startsWith("**") && chunk.endsWith("**") && chunk.length > 4 ? (
      <strong key={index} className="font-semibold text-stone-900">
        {chunk.slice(2, -2)}
      </strong>
    ) : (
      chunk
    ),
  );
}

function AssistantDot({ accent }: { accent: string }) {
  return (
    <span
      className="mt-0.5 h-[22px] w-[22px] shrink-0 rounded-full"
      style={{ background: `radial-gradient(circle at 35% 30%, #c4b5fd, ${accent} 70%)` }}
      aria-hidden="true"
    />
  );
}

function Narration({ text, accent, agent, senderName }: { text: string; accent: string; agent: boolean; senderName?: string }) {
  if (agent) {
    return (
      <div className="flex items-start gap-2 animate-bubble-in-left">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-700 text-[10.5px] font-semibold text-white" aria-hidden="true">
          {(senderName || "S").charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold text-stone-500">{senderName || "Store team"}</p>
          <div className="bubble-agent whitespace-pre-wrap">{formatText(text)}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 animate-bubble-in-left">
      <AssistantDot accent={accent} />
      <p className="min-w-0 flex-1 whitespace-pre-wrap pt-0.5 text-[13.5px] leading-relaxed text-stone-800">{formatText(text)}</p>
    </div>
  );
}

const CAPABILITIES = [
  { kind: "products" as const, label: "Find & compare" },
  { kind: "cart" as const, label: "Fill your cart" },
  { kind: "order" as const, label: "Place orders" },
  { kind: "tracking" as const, label: "Track orders" },
];

function AssistantHero({
  assistantName,
  welcomeMessage,
  accent,
  voiceAvailable,
  onStartVoice,
  showOrb,
}: {
  assistantName: string;
  welcomeMessage: string;
  accent: string;
  voiceAvailable: boolean;
  onStartVoice?: () => void;
  showOrb: boolean;
}) {
  return (
    <div className="flex flex-col items-center px-2 pb-1 pt-3 text-center animate-fade-up">
      {showOrb ? (
        <button
          type="button"
          onClick={voiceAvailable ? onStartVoice : undefined}
          disabled={!voiceAvailable}
          aria-label={voiceAvailable ? "Tap to talk" : undefined}
          className="mb-3 rounded-full transition hover:scale-105 active:scale-95 disabled:cursor-default disabled:hover:scale-100"
        >
          <AssistantOrb size={92} state="still" accent={accent} />
        </button>
      ) : null}
      <p className="text-[18px] font-semibold leading-tight">
        <span className="ai-gradient-text">Hi, I&apos;m {assistantName}</span>
      </p>
      <p className="mt-1 max-w-[290px] text-[12.5px] leading-snug text-stone-600">{welcomeMessage}</p>
      {voiceAvailable ? (
        <button
          type="button"
          onClick={onStartVoice}
          className="mt-3 flex items-center gap-2 rounded-full bg-gradient-to-r from-indigo-600 via-fuchsia-600 to-cyan-600 px-5 py-2.5 text-[13px] font-semibold text-white shadow-lg transition hover:brightness-110 active:scale-95"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
          Tap to talk
        </button>
      ) : null}
      <div className="mt-4 grid w-full grid-cols-4 gap-1.5">
        {CAPABILITIES.map((capability) => (
          <div key={capability.label} className="flex flex-col items-center gap-1 rounded-xl bg-stone-50 px-1 py-2">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white"
              style={{ background: `linear-gradient(135deg, ${accent}, #8b5cf6)` }}
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {ICONS[capability.kind]}
              </svg>
            </span>
            <span className="text-[10.5px] font-medium leading-tight text-stone-600">{capability.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  welcomeMessage,
  assistantName,
  topics,
  accent,
  sending,
  cart,
  busyProductId,
  busyItemId,
  checkoutBusy,
  onAdd,
  onUpdate,
  onRemove,
  onCheckout,
  onSuggestion,
  confirmingOrder,
  onConfirmOrder,
  voiceAvailable = false,
  onStartVoice,
  voiceActive = false,
}: MessageListProps) {
  const hasCustomerMessage = messages.some((message) => message.role === "user");
  const hasAssistantMessage = messages.some((message) => message.role === "assistant");
  const lastId = messages[messages.length - 1]?.id;

  // Only the newest order summary can be confirmed, and only until an order is placed after it.
  const hasConfirmation = (message: ChatMessage) => message.parts.some((part) => part.type === "order_confirmation");
  let lastConfirmationAt = -1;
  messages.forEach((message, index) => {
    if (hasConfirmation(message)) lastConfirmationAt = index;
  });
  const placedAfterConfirmation =
    lastConfirmationAt !== -1 &&
    messages
      .slice(lastConfirmationAt + 1)
      .some((message) => message.role === "event" && message.parts.some((part) => part.type === "order_status"));
  const confirmationState = (message: ChatMessage): "open" | "placed" | "stale" =>
    messages[lastConfirmationAt]?.id !== message.id ? "stale" : placedAfterConfirmation ? "placed" : "open";

  // A form is answered once the customer has written anything after it.
  const answeredAfter = (message: ChatMessage) => {
    const at = messages.findIndex((entry) => entry.id === message.id);
    return messages.slice(at + 1).some((entry) => entry.role === "user");
  };

  // The newest action in the conversation gets the spotlight.
  let spotlightKey: string | null = null;
  messages.forEach((message) =>
    message.parts.forEach((part, index) => {
      if (actionMeta(part)) spotlightKey = `${message.id}-part-${index}`;
    }),
  );

  const renderActionBody = (message: ChatMessage, part: ChatPart, isLatest: boolean) => {
    switch (part.type) {
      case "product_list":
        return <ProductList products={part.products} accent={accent} busyProductId={busyProductId} onAdd={onAdd} />;
      case "cart_summary":
        return (
          <CartSummary
            cart={part.cart}
            accent={accent}
            busyItemId={busyItemId}
            checkoutBusy={checkoutBusy}
            onUpdate={onUpdate}
            onRemove={onRemove}
            onCheckout={() => onCheckout()}
          />
        );
      case "checkout_action":
        return (
          <CheckoutButton
            onClick={() => onCheckout()}
            busy={checkoutBusy}
            accent={accent}
            subtotalMinor={cart?.subtotalMinor}
            currency={cart?.currency}
          />
        );
      case "details_form":
        // Only the latest form is live; older ones would submit a stale cart.
        return isLatest ? (
          <DetailsForm
            prefill={part.prefill}
            accent={accent}
            busy={checkoutBusy}
            onSubmit={(details) => onCheckout(details)}
            onSkip={() => onCheckout()}
          />
        ) : (
          <p className="text-[11.5px] text-stone-500">Details form closed.</p>
        );
      case "contact_form":
        return (
          <ContactForm
            prefill={part.prefill}
            deliveryAreas={part.deliveryAreas}
            deliveryAreaId={part.deliveryAreaId}
            note={part.note}
            accent={accent}
            active={!answeredAfter(message)}
            onSubmit={onSuggestion}
          />
        );
      case "order_confirmation":
        return (
          <OrderConfirmationCard
            confirmation={part.confirmation}
            accent={accent}
            state={confirmationState(message)}
            busy={Boolean(confirmingOrder) || sending}
            onConfirm={() => onConfirmOrder(part.confirmation.confirmationId)}
            onEdit={onSuggestion}
          />
        );
      case "order_status":
        return (
          <div className="space-y-2">
            {part.orders.map((order) => (
              <OrderStatusCard key={order.orderNumber} order={order} accent={accent} />
            ))}
          </div>
        );
      default:
        return null;
    }
  };

  const renderPart = (message: ChatMessage, part: ChatPart, index: number, isLatest: boolean) => {
    const key = `${message.id}-part-${index}`;
    if (part.type === "text") {
      return part.text.trim() ? (
        <Narration
          key={key}
          text={part.text}
          accent={accent}
          agent={message.role === "agent"}
          senderName={message.senderName}
        />
      ) : null;
    }
    if (part.type === "refine_options") {
      return (
        <div key={key} className="pl-7">
          <RefineChips options={part.options} accent={accent} disabled={sending || !isLatest} onSelect={onSuggestion} />
        </div>
      );
    }
    const meta = actionMeta(part);
    if (!meta) return null;
    return (
      <ActionCard key={key} kind={meta.kind} label={meta.label} detail={meta.detail} accent={accent} highlight={key === spotlightKey}>
        {renderActionBody(message, part, isLatest)}
      </ActionCard>
    );
  };

  return (
    <div className="space-y-3" aria-live="polite">
      {!hasAssistantMessage ? (
        <AssistantHero
          assistantName={assistantName}
          welcomeMessage={welcomeMessage}
          accent={accent}
          voiceAvailable={voiceAvailable}
          onStartVoice={onStartVoice}
          showOrb={!voiceActive}
        />
      ) : null}

      {!hasCustomerMessage && topics.length > 0 ? (
        <div className={`flex flex-wrap gap-1.5 ${hasAssistantMessage ? "pl-7" : "justify-center"}`} role="group" aria-label="Suggested topics">
          {topics.map((topic, index) => (
            <button
              key={topic.label}
              type="button"
              onClick={() => onSuggestion(topic.prompt)}
              disabled={sending}
              className="animate-pop rounded-full border bg-white px-3 py-1.5 text-[11.5px] font-medium text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow active:scale-95 disabled:opacity-50"
              style={{ borderColor: `${accent}40`, animationDelay: `${150 + index * 70}ms` }}
            >
              {topic.label}
            </button>
          ))}
        </div>
      ) : null}

      {messages.map((message) => {
        const isLatest = message.id === lastId;

        if (message.role === "event") {
          const text = message.parts.find((part) => part.type === "text");
          const handoff = message.parts.find((part) => part.type === "handoff");
          const extra = message.parts.filter((part) => part.type === "order_status");
          return (
            <div key={message.id} className="space-y-2">
              <div className="flex justify-center">
                <span className="flex animate-pop items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1 text-[11px] text-stone-600">
                  {handoff && handoff.type === "handoff" && handoff.state === "waiting" ? (
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-amber-400" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                    </span>
                  ) : null}
                  {text && text.type === "text" ? text.text : message.parts.length ? "Update" : ""}
                </span>
              </div>
              {extra.map((part) =>
                part.type === "order_status" && part.orders.length === 1 && part.orders[0]!.status === "placed" ? (
                  <OrderSuccessCard key={`${message.id}-success`} order={part.orders[0]!} accent={accent} />
                ) : (
                  renderPart(message, part, message.parts.indexOf(part), isLatest)
                ),
              )}
            </div>
          );
        }

        if (message.role === "user") {
          const text = message.parts.find((part) => part.type === "text");
          // A hands-free voice turn: the transcript is the message, so don't also show an audio player.
          const spoken = message.attachments?.find(
            (attachment) => attachment.kind === "audio" && text?.type === "text" && attachment.transcript === text.text,
          );
          return (
            <div key={message.id} className="flex justify-end">
              <div className="flex max-w-[85%] flex-col items-end gap-1 animate-bubble-in-right">
                {message.attachments
                  ?.filter((attachment) => !(spoken && attachment.uploadId === spoken.uploadId))
                  .map((attachment) => (
                    <div key={attachment.uploadId} className="bubble-user px-2 py-2" style={{ backgroundColor: accent }}>
                      <AttachmentView attachment={attachment} onDark />
                    </div>
                  ))}
                {text && text.type === "text" && text.text ? (
                  <div className="bubble-user max-w-full whitespace-pre-wrap py-2 text-[13px]" style={{ backgroundColor: accent }}>
                    {spoken ? (
                      <svg aria-label="Spoken" role="img" viewBox="0 0 24 24" className="mr-1 inline h-3 w-3 align-[-1px] opacity-80" fill="none" stroke="currentColor" strokeWidth="2.4">
                        <rect x="9" y="3" width="6" height="11" rx="3" />
                        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                      </svg>
                    ) : null}
                    {text.text}
                  </div>
                ) : null}
              </div>
            </div>
          );
        }

        const visible = message.parts.filter((part) => part.type !== "text" || part.text.trim().length > 0);
        if (visible.length === 0) {
          return isLatest && sending ? (
            <div key={message.id} className="flex items-center gap-2 animate-fade-up" role="status" aria-label="Working on it">
              <AssistantDot accent={accent} />
              <span className="flex gap-1" aria-hidden="true">
                {[0, 160, 320].map((delay) => (
                  <span key={delay} className="h-1.5 w-1.5 animate-typing-dot rounded-full bg-stone-400" style={{ animationDelay: `${delay}ms` }} />
                ))}
              </span>
            </div>
          ) : null;
        }

        return (
          <div key={message.id} className="space-y-2">
            {message.parts.map((part, index) => renderPart(message, part, index, isLatest))}
          </div>
        );
      })}
    </div>
  );
}
