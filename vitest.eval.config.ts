import path from "node:path";
import { defineConfig } from "vitest/config";

// Accuracy test set: real model calls against the in-memory test database (never your real data).
// Set the same connection as Admin → AI model: EVAL_AI_PROVIDER, EVAL_AI_MODEL, EVAL_AI_API_KEY and,
// for providers other than OpenAI/Anthropic, EVAL_AI_BASE_URL. Run with `npm run test:eval`.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/eval/**/*.eval.ts"],
    globalSetup: ["tests/setup/global-setup.ts"],
    setupFiles: ["tests/setup/env.ts"],
    fileParallelism: false,
    testTimeout: 90_000,
  },
});
