"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { CartSummary } from "@/components/chat/CartSummary";
import { ContactForm, DetailsForm, OrderConfirmationCard, OrderStatusCard, OrderSuccessCard } from "@/components/chat/ChatParts";
import { CheckoutButton } from "@/components/chat/CheckoutButton";
import { ProductList } from "@/components/chat/ProductList";
import { playEarcon } from "@/lib/client/chime";
import type { CartPayload, ChatMessage, ChatPart, CustomerDetailsData } from "@/types/chat";

// What the assistant is doing, floating above the voice panel: the products it found, the cart, the
// order summary to confirm, the details form, the placed order. Only the newest set is shown; older
// ones are in the text chat.
//
// Cards are keyed by what they show (a product set, an order), not by message, so a live reply being
// saved, or the assistant showing the same thing twice, doesn't re-render or duplicate a card.

const ACTION_TYPES = new Set<ChatPart["type"]>([
  "product_list",
  "cart_summary",
  "checkout_action",
  "details_form",
  "contact_form",
  "order_confirmation",
  "order_status",
]);

function titleFor(part: ChatPart): string {
  switch (part.type) {
    case "product_list":
      return part.label || (part.products.length === 1 ? "Product" : "Products for you");
    case "cart_summary":
      return part.label || "Your cart";
    case "checkout_action":
      return "Ready to check out";
    case "details_form":
    case "contact_form":
      return "Your details";
    case "order_confirmation":
      return "Confirm your order";
    case "order_status":
      return part.orders.some((order) => order.status === "placed") ? "Order placed" : "Your order";
    default:
      return "";
  }
}

// Most important first; at most MAX_CARDS are shown so they stay readable above the panel.
const PRIORITY: Partial<Record<ChatPart["type"], number>> = {
  order_status: 0,
  order_confirmation: 1,
  contact_form: 2,
  details_form: 3,
  checkout_action: 4,
  cart_summary: 5,
  product_list: 6,
};
const MAX_CARDS = 2;

/** What a card shows, so the same thing keeps the same card. */
function identityOf(part: ChatPart): string {
  switch (part.type) {
    case "product_list":
      return `products:${part.products.map((product) => product.id).join(",")}`;
    case "order_confirmation":
      return `confirm:${part.confirmation.confirmationId}`;
    case "order_status":
      return `orders:${part.orders.map((order) => order.orderNumber).join(",")}`;
    default:
      return part.type;
  }
}

function FloatingCard({ title, index, children }: { title: string; index: number; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="card-float-in relative w-full shrink-0 rounded-3xl bg-white p-3 ring-1 ring-stone-200 sm:p-4"
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <header className="mb-2 flex items-center gap-2 pl-0.5">
        <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500" aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{title}</p>
      </header>
      {children}
    </section>
  );
}

/**
 * The cards to show: from the newest message that has any, one per kind, most important first.
 * `key` identifies what a card shows, so the same products or order keep the same card.
 */
export function pickLatestActions(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "assistant" && message.role !== "event") continue;
    // One card per kind (the last one wins), most important first.
    const byType = new Map<ChatPart["type"], ChatPart>();
    for (const part of message.parts) if (ACTION_TYPES.has(part.type)) byType.set(part.type, part);
    if (byType.size === 0) continue;
    // The order summary already lists the items: the cart card would repeat them.
    if (byType.has("order_confirmation") || byType.has("order_status")) byType.delete("cart_summary");
    const parts = [...byType.values()]
      .sort((a, b) => (PRIORITY[a.type] ?? 9) - (PRIORITY[b.type] ?? 9))
      .slice(0, MAX_CARDS)
      .map((part) => ({ part, key: identityOf(part) }));
    const answered = messages.slice(index + 1).some((entry) => entry.role === "user");
    const placed = messages
      .slice(index + 1)
      .some((entry) => entry.role === "event" && entry.parts.some((part) => part.type === "order_status"));
    return { message, parts, answered, placed };
  }
  return null;
}

export function FloatingActions({
  messages,
  cart,
  accent,
  sending,
  busyProductId,
  busyItemId,
  checkoutBusy,
  confirmingOrder,
  onAdd,
  onUpdate,
  onRemove,
  onCheckout,
  onConfirmOrder,
  onSendText,
}: {
  messages: ChatMessage[];
  cart: CartPayload | null;
  accent: string;
  sending: boolean;
  busyProductId: string | null;
  busyItemId: string | null;
  checkoutBusy: boolean;
  confirmingOrder: boolean;
  onAdd: (productId: string, variantId: string | null) => void;
  onUpdate: (itemId: string, quantity: number) => void;
  onRemove: (itemId: string) => void;
  onCheckout: (details?: CustomerDetailsData) => void;
  onConfirmOrder: (confirmationId: string) => void;
  /** Form answers go to the assistant as the customer's message. */
  onSendText: (text: string) => void;
}) {

  // The newest message with something to show, and whether an order followed its summary.
  const latest = useMemo(() => pickLatestActions(messages), [messages]);

  const visible = latest?.parts ?? [];

  // A soft tick when new cards arrive.
  const announcedRef = useRef<string | null>(null);
  const newestKey = visible[0]?.key ?? null;
  useEffect(() => {
    if (!newestKey || announcedRef.current === newestKey) return;
    const first = announcedRef.current === null;
    announcedRef.current = newestKey;
    if (!first) void playEarcon("card");
  }, [newestKey]);

  if (!latest || visible.length === 0) return null;

  const body = (part: ChatPart): ReactNode => {
    switch (part.type) {
      case "product_list":
        return <ProductList products={part.products} accent={accent} busyProductId={busyProductId} onAdd={onAdd} size="wide" />;
      case "cart_summary":
        return (
          <CartSummary
            cart={cart && cart.cartId === part.cart.cartId ? cart : part.cart}
            accent={accent}
            busyItemId={busyItemId}
            checkoutBusy={checkoutBusy}
            onUpdate={onUpdate}
            onRemove={onRemove}
            onCheckout={() => onCheckout()}
            compact
          />
        );
      case "checkout_action":
        return (
          <CheckoutButton onClick={() => onCheckout()} busy={checkoutBusy} accent={accent} subtotalMinor={cart?.subtotalMinor} currency={cart?.currency} />
        );
      case "details_form":
        return (
          <DetailsForm prefill={part.prefill} accent={accent} busy={checkoutBusy} onSubmit={(details) => onCheckout(details)} onSkip={() => onCheckout()} />
        );
      case "contact_form":
        return (
          <ContactForm
            prefill={part.prefill}
            deliveryAreas={part.deliveryAreas}
            deliveryAreaId={part.deliveryAreaId}
            note={part.note}
            accent={accent}
            active={!latest.answered}
            onSubmit={onSendText}
          />
        );
      case "order_confirmation":
        return (
          <OrderConfirmationCard
            confirmation={part.confirmation}
            accent={accent}
            state={latest.placed ? "placed" : "open"}
            busy={confirmingOrder || sending}
            onConfirm={() => onConfirmOrder(part.confirmation.confirmationId)}
            onEdit={onSendText}
          />
        );
      case "order_status":
        return (
          <div className="space-y-2">
            {part.orders.map((order) =>
              order.status === "placed" ? (
                <OrderSuccessCard key={order.orderNumber} order={order} accent={accent} />
              ) : (
                <OrderStatusCard key={order.orderNumber} order={order} accent={accent} />
              ),
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      {[...visible].reverse().map(({ part, key }, index) => (
        <FloatingCard
          key={key}
          index={index}
          title={titleFor(part)}
        >
          {body(part)}
        </FloatingCard>
      ))}
    </>
  );
}
