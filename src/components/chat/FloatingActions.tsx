"use client";

import { useMemo, type ReactNode } from "react";
import { CartCard } from "@/components/chat/CartCard";
import { ContactForm, DetailsForm, OrderConfirmationCard, OrderStatusCard, OrderSuccessCard } from "@/components/chat/ChatParts";
import { CheckoutButton } from "@/components/chat/CheckoutButton";
import { ProductList } from "@/components/chat/ProductList";
import type { CartPayload, ChatMessage, ChatPart, CustomerDetailsData } from "@/types/chat";

// What the assistant is doing, floating over the blurred page: the products it found (a grid from the
// left of the screen), and the cart, details form, order summary or placed order (a card beside the
// voice panel). Only the newest set is shown; older ones are in the text chat.
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

const ICONS: Partial<Record<ChatPart["type"], string>> = {
  cart_summary: "M2.5 3h2.6l2.4 12h11l2-8.5H6.2M9 20h.01M18 20h.01",
  checkout_action: "M5 12h14M13 6l6 6-6 6",
  details_form: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  contact_form: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  order_confirmation: "M9 11l2 2 4-4M5 4h14v16H5z",
  order_status: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
};

/** A card beside the voice panel: a clear title with an icon, then the content. */
function PanelCard({ part, index, children }: { part: ChatPart; index: number; children: ReactNode }) {
  const title = titleFor(part);
  return (
    <section
      aria-label={title}
      className="card-slide-in relative w-full shrink-0 rounded-[26px] bg-white p-4 ring-1 ring-black/5"
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <header className="mb-3 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d={ICONS[part.type] ?? ICONS.order_confirmation} />
          </svg>
        </span>
        <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-stone-900">{title}</p>
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
  slot,
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
  /** products: the product grid · panel: cart, forms and order cards beside the voice panel. */
  slot: "products" | "panel";
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
  const visible = (latest?.parts ?? []).filter(({ part }) => (part.type === "product_list") === (slot === "products"));
  if (!latest || visible.length === 0) return null;

  const body = (part: ChatPart): ReactNode => {
    switch (part.type) {
      case "product_list":
        return <ProductList products={part.products} accent={accent} busyProductId={busyProductId} onAdd={onAdd} display="grid" />;
      case "cart_summary":
        return (
          <CartCard
            cart={cart && cart.cartId === part.cart.cartId ? cart : part.cart}
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

  if (slot === "products") {
    // No box around the products: a title on the blur, then the cards themselves.
    const { part, key } = visible[0]!;
    const single = part.type === "product_list" && part.products.length === 1;
    return (
      <div key={key} className={single ? "max-w-xl" : ""}>
        <p className="caption-in mb-3 inline-flex items-center gap-2 rounded-full bg-white/90 px-3.5 py-1.5 text-[12.5px] font-semibold text-stone-800 ring-1 ring-black/5">
          <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500" aria-hidden="true" />
          {titleFor(part)}
          {part.type === "product_list" && part.products.length > 1 ? (
            <span className="font-normal text-stone-500">· {Math.min(part.products.length, 12)}</span>
          ) : null}
        </p>
        {body(part)}
      </div>
    );
  }

  return (
    <>
      {visible.map(({ part, key }, index) => (
        <PanelCard key={key} index={index} part={part}>
          {body(part)}
        </PanelCard>
      ))}
    </>
  );
}

/** Whether the newest cards include any for this slot (to lay out the stage). */
export function hasSlot(latest: ReturnType<typeof pickLatestActions>, slot: "products" | "panel"): boolean {
  return (latest?.parts ?? []).some(({ part }) => (part.type === "product_list") === (slot === "products"));
}
