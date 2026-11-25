"use client";

import { CartSummary } from "@/components/chat/CartSummary";
import { ContactForm, DetailsForm, OrderConfirmationCard, OrderStatusCard, OrderSuccessCard, RefineChips } from "@/components/chat/ChatParts";
import { CheckoutButton } from "@/components/chat/CheckoutButton";
import { ActionCard, actionMeta, ComparisonTable } from "@/components/chat/MessageList";
import { ProductList } from "@/components/chat/ProductList";
import type { ChatPart } from "@/types/chat";

// One card exactly as the customer saw it in the chat widget (same components), for read-only views
// such as the admin inbox. Buttons do nothing here; wrap the view in an `inert` container so they
// can't be focused or clicked either.

const noop = () => undefined;

export function ChatPartView({
  part,
  accent,
  confirmationState = "stale",
}: {
  part: ChatPart;
  accent: string;
  /** For order summaries: whether that order was then placed. */
  confirmationState?: "open" | "placed" | "stale";
}) {
  if (part.type === "text" || part.type === "suggestion_actions") return null;
  if (part.type === "navigate") {
    return <p className="text-[11px] text-stone-500">Opened page: {part.label}</p>;
  }
  if (part.type === "refine_options") {
    return <RefineChips options={part.options} accent={accent} disabled onSelect={noop} />;
  }
  if (part.type === "knowledge_sources") {
    return (
      <p className="text-[11px] text-stone-500">
        Answered from store info: {part.sources.map((source) => source.title).join(", ")}
      </p>
    );
  }
  if (part.type === "order_status" && part.orders.length === 1 && part.orders[0]!.status === "placed") {
    return <OrderSuccessCard order={part.orders[0]!} accent={accent} />;
  }
  const meta = actionMeta(part);
  if (!meta) return null;
  const body = (() => {
    switch (part.type) {
      case "product_list":
        return <ProductList products={part.products} accent={accent} busyProductId={null} onAdd={noop} />;
      case "cart_summary":
        return <CartSummary cart={part.cart} accent={accent} busyItemId={null} checkoutBusy={false} onUpdate={noop} onRemove={noop} onCheckout={noop} />;
      case "checkout_action":
        return <CheckoutButton onClick={noop} busy={false} accent={accent} />;
      case "details_form":
        return <DetailsForm prefill={part.prefill} accent={accent} busy={false} onSubmit={noop} onSkip={noop} />;
      case "contact_form":
        return (
          <ContactForm
            prefill={part.prefill}
            deliveryAreas={part.deliveryAreas}
            deliveryAreaId={part.deliveryAreaId}
            note={part.note}
            accent={accent}
            active={false}
            onSubmit={noop}
          />
        );
      case "order_confirmation":
        return (
          <OrderConfirmationCard
            confirmation={part.confirmation}
            accent={accent}
            state={confirmationState}
            busy={false}
            onConfirm={noop}
            onEdit={noop}
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
      case "comparison":
        return <ComparisonTable part={part} />;
      default:
        return null;
    }
  })();
  return (
    <ActionCard kind={meta.kind} label={meta.label} detail={meta.detail} accent={accent} highlight={false}>
      {body}
    </ActionCard>
  );
}
