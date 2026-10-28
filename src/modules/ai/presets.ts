// Provider choices offered in the dashboard. "anthropic" uses the official Anthropic SDK;
// every other preset goes through the OpenAI-compatible chat-completions adapter.

export type ProviderKind = "anthropic" | "openai-compatible";

export type ProviderPreset = {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Suggested model; the admin can type any model the provider serves. */
  suggestedModel: string;
  keyRequired: boolean;
  keyHelpUrl?: string;
  note?: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    kind: "anthropic",
    baseUrl: "",
    suggestedModel: "claude-opus-5-5",
    keyRequired: true,
    keyHelpUrl: "https://platform.claude.com/settings/keys",
    note: "Uses the official Anthropic SDK. Refusal fallback is enabled automatically on supported models.",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    suggestedModel: "",
    keyRequired: true,
    keyHelpUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    suggestedModel: "",
    keyRequired: true,
    keyHelpUrl: "https://openrouter.ai/keys",
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    suggestedModel: "",
    keyRequired: true,
    keyHelpUrl: "https://console.groq.com/keys",
  },
  {
    id: "gemini",
    label: "Google Gemini (OpenAI-compatible endpoint)",
    kind: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    suggestedModel: "",
    keyRequired: true,
    keyHelpUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "ollama",
    label: "Ollama (self-hosted)",
    kind: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    suggestedModel: "",
    keyRequired: false,
    note: "The model must support tool calling.",
  },
  {
    id: "openai-compatible",
    label: "Other OpenAI-compatible API",
    kind: "openai-compatible",
    baseUrl: "",
    suggestedModel: "",
    keyRequired: false,
    note: "Any endpoint that implements /chat/completions with streaming tool calls.",
  },
];

export function getPreset(id: string | null | undefined): ProviderPreset {
  return PROVIDER_PRESETS.find((preset) => preset.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]!;
}

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
