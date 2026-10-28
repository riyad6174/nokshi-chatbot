"use client";

import { CartSummary } from "@/components/chat/CartSummary";
import { AttachmentView, DetailsForm, OrderStatusCard, RefineChips } from "@/components/chat/ChatParts";
import { CheckoutButton } from "@/components/chat/CheckoutButton";
import { ProductList } from "@/components/chat/ProductList";
import type { CartPayload, ChatMessage, ChatPart, CustomerDetailsData, SuggestedTopic } from "@/types/chat";

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
};

function TypingDots({ label }: { label: string }) {
  return (
    <div className="bubble-assistant inline-flex items-center gap-1 py-3" aria-label={label} role="status">
      {[0, 160, 320].map((delay) => (
        <span key={delay} className="h-1.5 w-1.5 animate-typing-dot rounded-full bg-stone-400" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </div>
  );
}

function Avatar({ name, agent, accent }: { name: string; agent?: boolean; accent: string }) {
  return (
    <div
      className="mt-0.5 flex h-7 w-7 shrink-0 animate-pop items-center justify-center rounded-full text-[11px] font-semibold text-white shadow-sm"
      style={{ backgroundColor: agent ? "#44403c" : accent }}
      aria-hidden="true"
    >
      {agent ? name.charAt(0).toUpperCase() : (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
          <path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4z" />
        </svg>
      )}
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
}: MessageListProps) {
  const hasCustomerMessage = messages.some((message) => message.role === "user");
  const lastId = messages[messages.length - 1]?.id;

  const renderPart = (message: ChatMessage, part: ChatPart, index: number, isLatest: boolean) => {
    const key = `${message.id}-part-${index}`;
    switch (part.type) {
      case "text":
        return part.text.trim() ? (
          <div
            key={key}
            className={`${message.role === "agent" ? "bubble-agent" : "bubble-assistant"} whitespace-pre-wrap animate-bubble-in-left`}
            style={{ animationDelay: `${index * 60}ms` }}
          >
            {part.text}
          </div>
        ) : null;
      case "product_list":
        return <ProductList key={key} products={part.products} accent={accent} busyProductId={busyProductId} onAdd={onAdd} />;
      case "cart_summary":
        return (
          <CartSummary
            key={key}
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
          <div key={key} className="animate-fade-up pt-0.5">
            <CheckoutButton
              onClick={() => onCheckout()}
              busy={checkoutBusy}
              accent={accent}
              subtotalMinor={cart?.subtotalMinor}
              currency={cart?.currency}
            />
          </div>
        );
      case "refine_options":
        return <RefineChips key={key} options={part.options} accent={accent} disabled={sending || !isLatest} onSelect={onSuggestion} />;
      case "details_form":
        // Only the latest form is live; older ones would submit a stale cart.
        return isLatest ? (
          <DetailsForm
            key={key}
            prefill={part.prefill}
            accent={accent}
            busy={checkoutBusy}
            onSubmit={(details) => onCheckout(details)}
            onSkip={() => onCheckout()}
          />
        ) : null;
      case "order_status":
        return (
          <div key={key} className="space-y-2">
            {part.orders.map((order) => (
              <OrderStatusCard key={order.orderNumber} order={order} accent={accent} />
            ))}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-3" aria-live="polite">
      {!messages.some((message) => message.role === "assistant") ? (
        <div className="flex items-start gap-2">
          <Avatar name={assistantName} accent={accent} />
          <div className="bubble-assistant whitespace-pre-wrap animate-bubble-in-left">{welcomeMessage}</div>
        </div>
      ) : null}

      {!hasCustomerMessage && topics.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pl-9" role="group" aria-label="Suggested topics">
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
              {extra.map((part, index) => renderPart(message, part, index, isLatest))}
            </div>
          );
        }

        if (message.role === "user") {
          const text = message.parts.find((part) => part.type === "text");
          return (
            <div key={message.id} className="flex justify-end">
              <div className="flex max-w-[88%] flex-col items-end gap-1 animate-bubble-in-right">
                {message.attachments?.map((attachment) => (
                  <div key={attachment.uploadId} className="bubble-user px-2 py-2" style={{ backgroundColor: accent }}>
                    <AttachmentView attachment={attachment} onDark />
                  </div>
                ))}
                {text && text.type === "text" && text.text ? (
                  <div className="bubble-user max-w-full whitespace-pre-wrap" style={{ backgroundColor: accent }}>
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
            <div key={message.id} className="flex items-start gap-2">
              <Avatar name={assistantName} accent={accent} />
              <TypingDots label={`${assistantName} is typing`} />
            </div>
          ) : null;
        }

        const agent = message.role === "agent";
        return (
          <div key={message.id} className="flex items-start gap-2">
            <Avatar name={message.senderName || assistantName} agent={agent} accent={accent} />
            <div className="min-w-0 flex-1 space-y-1.5">
              {agent ? <p className="text-[10.5px] font-semibold text-stone-500">{message.senderName || "Store team"}</p> : null}
              {visible.map((part, index) => renderPart(message, part, index, isLatest))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
