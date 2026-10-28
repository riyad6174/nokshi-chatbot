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

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "product_list"; products: ProductCardData[] }
  | { type: "cart_summary"; cart: CartPayload }
  | { type: "checkout_action" }
  | { type: "refine_options"; options: RefineOptions }
  | { type: "details_form"; prefill: Partial<CustomerDetailsData> }
  | { type: "order_status"; orders: OrderStatusData[] }
  | { type: "handoff"; state: "waiting" | "joined" | "released" | "closed"; agentName?: string };

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
};

export type SuggestedTopic = { label: string; prompt: string };

export type ConversationMode = "bot" | "waiting_human" | "human" | "closed";

export type WidgetSettingsPayload = {
  assistantName: string;
  welcomeMessage: string;
  fallbackMessage: string;
  suggestedTopics: SuggestedTopic[];
  voiceEnabled: boolean;
  attachmentsEnabled: boolean;
  theme: { accent?: string; position?: "left" | "right" };
  aiMode: "live" | "demo";
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
