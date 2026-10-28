import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: z
    .string()
    .min(16, "AUTH_SECRET must be at least 16 characters")
    .default("dev-only-secret-change-me-4f8a1c9b"),
  WIDGET_PUBLIC_KEY: z.string().min(1).default("demo-widget-key"),
  AI_PROVIDER: z.string().default("openai-compatible"),
  AI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  AI_API_KEY: z.string().default(""),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  COMMERCE_PROVIDER: z.string().default("internal"),
  COMMERCE_TRUSTED_HOSTS: z.string().default(""),
  ADMIN_EMAIL: z.string().email().default("admin@example.com"),
  ADMIN_PASSWORD: z.string().default("admin12345"),
  ADMIN_NAME: z.string().default("Store Admin"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = {
  ...parsed.data,
  AI_BASE_URL: parsed.data.AI_BASE_URL.replace(/\/+$/, ""),
  isProduction: parsed.data.NODE_ENV === "production",
  aiConfigured: parsed.data.AI_API_KEY.trim().length > 0,
  trustedCheckoutHosts: parsed.data.COMMERCE_TRUSTED_HOSTS.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
};

// Enforced when the server runs, not during `next build`: hosts often inject secrets only at runtime.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

if (env.isProduction && !isBuildPhase && env.AUTH_SECRET.startsWith("dev-only")) {
  throw new Error("AUTH_SECRET must be set to a strong random value in production.");
}
