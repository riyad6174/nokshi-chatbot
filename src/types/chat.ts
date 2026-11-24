export type ProductVariantData = {
  id: string;
  sku: string;
  title: string;
  options: Record<string, string>;
  priceMinor: number;
  stockStatus: string;
  available: boolean;
};

export type ProductCardData = {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  brand: string;
  attributes: Record<string, string>;
  imageUrl: string | null;
  priceMinor: number;
  currency: string;
  available: boolean;
  variants: ProductVariantData[];
};

export type CartLineData = {
  itemId: string;
  productId: string;
  variantId: string | null;
  name: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  available: boolean;
};

export type CartPayload = {
  cartId: string;
  currency: string;
  items: CartLineData[];
  itemCount: number;
  subtotalMinor: number;
};

export type OrderLineData = {
  name: string;
  variantTitle: string | null;
  quantity: number;
  lineTotalMinor: number;
};

export type OrderStatusData = {
  orderNumber: string;
  status: string;
  statusLabel: string;
  paymentMethod: string;
  paymentStatus: string;
  totalMinor: number;
  currency: string;
  placedAt: string;
  trackingNumber: string;
  items: OrderLineData[];
  history: Array<{ status: string; label: string; at: string; note: string }>;
};

/** Facets the customer can tap to narrow a product search (e.g. color: Black, Olive). */
export type RefineOptions = {
  query: string;
  facets: Array<{ name: string; values: string[] }>;
};

export type CustomerDetailsData = {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  notes: string;
};

/** The order summary the customer confirms before a cash-on-delivery order is placed from the chat. */
export type OrderConfirmationData = {
  confirmationId: string;
  lines: Array<{ name: string; variantTitle: string | null; quantity: number; unitPriceMinor: number; lineTotalMinor: number }>;
  subtotalMinor: number;
  shippingMinor: number;
  totalMinor: number;
  currency: string;
  deliveryArea: string | null;
  customer: CustomerDetailsData;
  paymentMethod: "cod";
};

export type ChatPart =
  | { type: "text"; text: string }
  /** `label` names the action for its card, e.g. "Recommended for you", "Added to cart". */
  | { type: "product_list"; products: ProductCardData[]; label?: string }
  | { type: "cart_summary"; cart: CartPayload; label?: string }
  | { type: "checkout_action" }
  | { type: "refine_options"; options: RefineOptions }
  | { type: "details_form"; prefill: Partial<CustomerDetailsData> }
  | { type: "order_status"; orders: OrderStatusData[] }
  | { type: "order_confirmation"; confirmation: OrderConfirmationData }
  /** Takes the customer to a page of the store (a product page, checkout). Not shown as a card. */
  | { type: "navigate"; url: string; label: string }
  /** Editable contact/delivery form; the customer sends it back as a message with the exact details. */
  | {
      type: "contact_form";
      prefill: Partial<CustomerDetailsData>;
      deliveryAreas: Array<{ id: string; label: string }>;
      deliveryAreaId: string;
      note: string;
    }
  | { type: "handoff"; state: "waiting" | "joined" | "released" | "closed"; agentName?: string }
  /** Side-by-side catalog facts for 2-4 products. */
  | { type: "comparison"; products: ProductCardData[]; rows: Array<{ label: string; values: string[] }> }
  /** Buttons under a proactive suggestion: "No thanks" and "Stop suggestions". */
  | { type: "suggestion_actions"; suggestionId: string; trigger: string }
  /**
   * The policy excerpts a reply was based on. Saved with the message for the model's memory, so a
   * follow-up ("and for Chittagong?") is answered from the same source. Never sent to the widget.
   */
  | { type: "knowledge_sources"; sources: Array<{ title: string; excerpt: string }> }
  /** The reply was the store's fallback text (no real answer). Model memory only; never shown. */
  | { type: "fallback_reply" };

export type AttachmentData = {
  uploadId: string;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "audio" | "file";
  url: string;
  transcript?: string | null;
  durationMs?: number | null;
};

export type ChatRole = "user" | "assistant" | "agent" | "event";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  parts: ChatPart[];
  attachments?: AttachmentData[];
  senderName?: string;
  createdAt: string;
  /** Client only: the on-screen key, kept when a temporary id is swapped for the server's. */
  localKey?: string;
};

export type SuggestedTopic = { label: string; prompt: string };

export type ConversationMode = "bot" | "waiting_human" | "human" | "closed";

export type VoiceEngine = "gemini" | "realtime" | "cascade";

export type WidgetSettingsPayload = {
  assistantName: string;
  welcomeMessage: string;
  fallbackMessage: string;
  suggestedTopics: SuggestedTopic[];
  voiceEnabled: boolean;
  /** Hands-free voice assistant. speech "server": cloud STT/TTS; "browser": the browser's own recognition and voices. */
  /** engine "gemini": Gemini Live over WebSocket; "realtime": OpenAI Realtime over WebRTC; "cascade": speech-to-text, chat model, text-to-speech. */
  /** language: the language chosen in Admin → AI Sales & Engagement ("auto": follow the customer). */
  voiceAssistant: { enabled: boolean; speech: "server" | "browser"; engine: VoiceEngine; maxSessionMinutes: number; language?: "bn" | "en" | "auto" };
  attachmentsEnabled: boolean;
  theme: { accent?: string; position?: "left" | "right" };
  aiMode: "live" | "demo";
  /** Proactive engagement: which activity to report, and after how many seconds (null = off). */
  engagement?: {
    enabled: boolean;
    triggers: Record<"search" | "product_view" | "compare" | "add_to_cart" | "cart_idle" | "checkout_start", number | null>;
    nudgeWhenClosed: boolean;
  };
};

export type WidgetSessionResponse = {
  sessionId: string;
  conversationId: string;
  visitorId: string;
  locale: string;
  store: {
    name: string;
    currency: string;
    supportedLocales: string[];
  };
  settings: WidgetSettingsPayload;
  messages: ChatMessage[];
  cart: CartPayload;
  conversationMode: ConversationMode;
};

export type CheckoutResponse = {
  checkoutSessionId: string;
  checkoutUrl: string;
  cartSummary: CartPayload;
};

export type SseEvent =
  | { event: "message.started"; data: Record<string, never> }
  | { event: "message.delta"; data: { text: string } }
  | { event: "ui.product_list"; data: { products: ProductCardData[] } }
  | { event: "ui.cart"; data: { cart: CartPayload } }
  | { event: "ui.checkout"; data: { requiresConfirmation: true } }
  | { event: "message.completed"; data: { messageId: string } }
  | { event: "message.error"; data: { message: string; retryable: boolean } };
