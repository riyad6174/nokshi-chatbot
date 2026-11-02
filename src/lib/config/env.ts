import { z } from "zod";

// Hosting dashboards (e.g. Vercel) store variables left blank as "", so treat blank as "not set"
// and fall back to the default instead of failing validation.
const blankAsUnset = (schema: z.ZodTypeAny) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), schema);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: blankAsUnset(z.string({ required_error: "DATABASE_URL is required (your MongoDB Atlas connection string)" }).min(1)),
  APP_BASE_URL: blankAsUnset(z.string().url("APP_BASE_URL must be a full URL like https://your-app.vercel.app").default("http://localhost:3000")),
  AUTH_SECRET: blankAsUnset(
    z.string().min(16, "AUTH_SECRET must be at least 16 characters").default("dev-only-secret-change-me-4f8a1c9b"),
  ),
  WIDGET_PUBLIC_KEY: blankAsUnset(z.string().min(1).default("demo-widget-key")),
  AI_PROVIDER: blankAsUnset(z.string().default("openai-compatible")),
  AI_BASE_URL: blankAsUnset(z.string().url().default("https://api.openai.com/v1")),
  AI_API_KEY: z.string().default(""),
  AI_MODEL: blankAsUnset(z.string().default("gpt-4o-mini")),
  COMMERCE_PROVIDER: blankAsUnset(z.string().default("internal")),
  COMMERCE_TRUSTED_HOSTS: z.string().default(""),
  ADMIN_EMAIL: blankAsUnset(z.string().email().default("admin@example.com")),
  ADMIN_PASSWORD: blankAsUnset(z.string().default("admin12345")),
  ADMIN_NAME: blankAsUnset(z.string().default("Store Admin")),
  // Voice assistant speech service. "browser" uses the visitor's own speech recognition and voices.
  SPEECH_PROVIDER: blankAsUnset(z.enum(["browser", "azure", "openai"]).default("browser")),
  SPEECH_API_KEY: z.string().default(""),
  SPEECH_REGION: blankAsUnset(z.string().default("")),
  SPEECH_BASE_URL: blankAsUnset(z.string().url().default("https://api.openai.com/v1")),
  SPEECH_STT_MODEL: blankAsUnset(z.string().default("gpt-4o-mini-transcribe")),
  SPEECH_TTS_MODEL: blankAsUnset(z.string().default("gpt-4o-mini-tts")),
  SPEECH_VOICE_EN: blankAsUnset(z.string().default("")),
  SPEECH_VOICE_BN: blankAsUnset(z.string().default("")),
  // Speaking speed for Azure voices, e.g. "+10%" (a bit faster than normal) or "0%".
  SPEECH_RATE: blankAsUnset(z.string().regex(/^[+-]?\d{1,2}%$/, "SPEECH_RATE looks like +10%").default("+10%")),
  VOICE_MAX_SESSION_MINUTES: blankAsUnset(z.coerce.number().int().min(1).max(120).default(15)),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid environment configuration: ${details}. Set these in your host's environment variables and redeploy.`);
}

const data = parsed.data as {
  NODE_ENV: "development" | "test" | "production";
  DATABASE_URL: string;
  APP_BASE_URL: string;
  AUTH_SECRET: string;
  WIDGET_PUBLIC_KEY: string;
  AI_PROVIDER: string;
  AI_BASE_URL: string;
  AI_API_KEY: string;
  AI_MODEL: string;
  COMMERCE_PROVIDER: string;
  COMMERCE_TRUSTED_HOSTS: string;
  ADMIN_EMAIL: string;
  ADMIN_PASSWORD: string;
  ADMIN_NAME: string;
  SPEECH_PROVIDER: "browser" | "azure" | "openai";
  SPEECH_API_KEY: string;
  SPEECH_REGION: string;
  SPEECH_BASE_URL: string;
  SPEECH_STT_MODEL: string;
  SPEECH_TTS_MODEL: string;
  SPEECH_VOICE_EN: string;
  SPEECH_VOICE_BN: string;
  SPEECH_RATE: string;
  VOICE_MAX_SESSION_MINUTES: number;
};

export const env = {
  ...data,
  AI_BASE_URL: data.AI_BASE_URL.replace(/\/+$/, ""),
  isProduction: data.NODE_ENV === "production",
  aiConfigured: data.AI_API_KEY.trim().length > 0,
  trustedCheckoutHosts: data.COMMERCE_TRUSTED_HOSTS.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
};

// Enforced when the server runs, not during `next build`: hosts often inject secrets only at runtime.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

if (env.isProduction && !isBuildPhase && env.AUTH_SECRET.startsWith("dev-only")) {
  throw new Error(
    "AUTH_SECRET is not set. Add a random value of 32+ characters as AUTH_SECRET in your host's environment variables " +
      '(generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))") and redeploy.',
  );
}
