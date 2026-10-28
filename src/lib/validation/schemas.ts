import { z } from "zod";

export const widgetSessionRequestSchema = z.object({
  widgetKey: z.string().min(1).max(200),
  visitorId: z.string().max(100).nullish(),
  locale: z.string().min(2).max(20).optional(),
  // Product page the chat was opened from, for a product-aware greeting.
  productId: z.string().max(100).optional(),
});

export const widgetMessageRequestSchema = z
  .object({
    conversationId: z.string().min(1).max(100),
    message: z.string().trim().max(2000).default(""),
    locale: z.string().min(2).max(20).optional(),
    attachments: z
      .array(
        z.object({
          uploadId: z.string().max(50),
          // Browser speech-to-text result for voice notes.
          transcript: z.string().max(2000).optional(),
          durationMs: z.number().int().min(0).max(600_000).optional(),
        }),
      )
      .max(4)
      .default([]),
  })
  .refine((value) => value.message.length > 0 || value.attachments.length > 0, {
    message: "Message cannot be empty",
    path: ["message"],
  });

export const addCartItemSchema = z.object({
  productId: z.string().min(1).max(100),
  variantId: z.string().min(1).max(100).nullish(),
  quantity: z.number().int().min(1).max(99).default(1),
});

export const updateCartItemSchema = z.object({
  itemId: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(99),
});

export const removeCartItemSchema = z.object({
  itemId: z.string().min(1).max(100),
});

export const customerDetailsSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(100),
  // Loose on purpose: local and international formats. At least 8 digits.
  phone: z
    .string()
    .trim()
    .max(25)
    .refine((value) => value.replace(/\D/g, "").length >= 8, "Enter a valid phone number"),
  email: z.string().trim().max(200).email("Enter a valid email").or(z.literal("")).default(""),
  address: z.string().trim().min(5, "Enter a delivery address").max(400),
  city: z.string().trim().max(100).default(""),
  notes: z.string().trim().max(500).default(""),
});

export const checkoutRequestSchema = z.object({
  confirmed: z.literal(true),
  idempotencyKey: z.string().min(8).max(200).optional(),
  customer: customerDetailsSchema.optional(),
});

export const placeOrderFormSchema = z.object({
  token: z.string().min(10).max(200),
  customer: customerDetailsSchema,
  shippingZoneId: z.string().max(50).default(""),
  paymentMethod: z.enum(["cod", "online"]),
});

export const orderStatusFormSchema = z.object({
  orderId: z.string().min(1).max(50),
  status: z.enum(["placed", "confirmed", "processing", "shipped", "delivered", "cancelled", "refunded"]),
  note: z.string().trim().max(500).default(""),
  trackingNumber: z.string().trim().max(100).optional(),
});

export const adminLoginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export const productFormSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and dashes"),
  description: z.string().trim().max(5000).default(""),
  category: z.string().trim().min(1).max(100),
  price: z.coerce.number().min(0).max(10_000_000),
  imageUrl: z.string().trim().max(500).optional().or(z.literal("")),
  externalProductId: z.string().trim().max(200).optional().or(z.literal("")),
  status: z.enum(["active", "inactive"]).default("active"),
});

export const variantFormSchema = z.object({
  productId: z.string().min(1),
  sku: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  externalVariantId: z.string().trim().max(200).optional().or(z.literal("")),
  priceOverride: z.coerce.number().min(0).max(10_000_000).optional(),
  stockQuantity: z.coerce.number().int().min(0).max(1_000_000).optional(),
  stockStatus: z.enum(["in_stock", "out_of_stock"]).default("in_stock"),
  options: z.string().trim().max(1000).default("{}"),
});

export const knowledgeFormSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(20).max(20_000),
  sourceType: z.enum(["manual", "url", "file"]).default("manual"),
  sourceReference: z.string().trim().max(500).optional().or(z.literal("")),
  status: z.enum(["pending", "ready", "failed"]).default("ready"),
});

export const storeSettingsFormSchema = z.object({
  name: z.string().trim().min(1).max(120),
  websiteDomain: z.string().trim().min(1).max(200),
  currency: z.string().trim().length(3).toUpperCase(),
  defaultLocale: z.string().trim().min(2).max(20),
  supportedLocales: z.string().trim().min(2).max(200),
  trustedCheckoutHosts: z.string().trim().max(1000),
});

export const chatbotSettingsFormSchema = z.object({
  welcomeMessage: z.string().trim().min(1).max(2000),
  fallbackMessage: z.string().trim().min(1).max(2000),
  systemInstructions: z.string().trim().max(8000),
  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #0f766e")
    .default("#0f766e"),
  enabledFeatures: z.string().trim().max(1000).default(""),
});

export const aiConnectionFormSchema = z.object({
  provider: z.string().trim().min(1).max(50),
  baseUrl: z
    .string()
    .trim()
    .max(300)
    .refine((value) => value === "" || /^https?:\/\//i.test(value), "Base URL must start with http:// or https://"),
  apiKey: z.string().trim().max(500),
  clearKey: z.boolean(),
  model: z.string().trim().min(1, "Choose a model").max(150),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
});
