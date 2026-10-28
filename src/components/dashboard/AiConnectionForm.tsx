"use client";

import { useActionState, useState } from "react";
import { saveAiConnectionAction, testAiConnectionAction, type ConnectionTestResult } from "@/app/admin/ai-actions";
import type { ProviderPreset } from "@/modules/ai/presets";

const inputClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[12px] text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none";
const labelClass = "text-[10.5px] font-medium text-stone-500";

type Props = {
  presets: ProviderPreset[];
  effortLevels: readonly string[];
  initial: {
    provider: string;
    baseUrl: string;
    model: string;
    effort: string;
    keySource: "dashboard" | "environment" | "none";
    keyLast4: string;
    keyUnreadable: boolean;
  };
};

export function AiConnectionForm({ presets, effortLevels, initial }: Props) {
  const [provider, setProvider] = useState(initial.provider);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [model, setModel] = useState(initial.model);
  const [testResult, testAction, testing] = useActionState<ConnectionTestResult | null, FormData>(
    testAiConnectionAction,
    null,
  );

  const preset = presets.find((entry) => entry.id === provider) ?? presets[presets.length - 1]!;
  const isAnthropic = preset.kind === "anthropic";

  const onProviderChange = (nextId: string) => {
    const previous = presets.find((entry) => entry.id === provider);
    const next = presets.find((entry) => entry.id === nextId);
    setProvider(nextId);
    if (!next) return;
    // Replace values the admin hasn't customised; keep anything they typed.
    if (!baseUrl || baseUrl === previous?.baseUrl) setBaseUrl(next.baseUrl);
    // Model names don't carry over between Claude and OpenAI-style APIs, so reset when the kind changes.
    if (!model || model === previous?.suggestedModel || previous?.kind !== next.kind) setModel(next.suggestedModel);
  };

  const keyHint =
    initial.keySource === "dashboard"
      ? `A key ending in …${initial.keyLast4} is saved (encrypted). Leave blank to keep it.`
      : initial.keySource === "environment"
        ? `Using AI_API_KEY from the server environment (…${initial.keyLast4}). A key saved here takes priority.`
        : "No key saved.";

  return (
    <form action={saveAiConnectionAction} className="mt-3 grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor="ai-provider" className={labelClass}>
          Provider
        </label>
        <select
          id="ai-provider"
          name="provider"
          value={provider}
          onChange={(event) => onProviderChange(event.target.value)}
          className={inputClass}
        >
          {presets.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        {preset.note ? <p className="mt-1 text-[10px] leading-relaxed text-stone-400">{preset.note}</p> : null}
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="ai-base-url" className={labelClass}>
          {isAnthropic ? "Base URL (optional: leave blank for api.anthropic.com)" : "Base URL"}
        </label>
        <input
          id="ai-base-url"
          name="baseUrl"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder={isAnthropic ? "https://api.anthropic.com" : "https://api.example.com/v1"}
          className={`${inputClass} font-mono`}
          autoComplete="off"
        />
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="ai-key" className={labelClass}>
          API key {preset.keyRequired ? "" : "(optional)"}
        </label>
        <input
          id="ai-key"
          name="apiKey"
          type="password"
          placeholder={initial.keySource === "dashboard" ? `•••• ${initial.keyLast4}` : "Paste a key"}
          className={`${inputClass} font-mono`}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="mt-1 text-[10px] leading-relaxed text-stone-400">
          {keyHint}{" "}
          {preset.keyHelpUrl ? (
            <a href={preset.keyHelpUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              Get a key
            </a>
          ) : null}
        </p>
        {initial.keyUnreadable ? (
          <p className="mt-1 text-[10.5px] text-red-600">
            The saved key can&apos;t be decrypted (AUTH_SECRET changed). Enter the key again.
          </p>
        ) : null}
        {initial.keySource === "dashboard" ? (
          <label className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-stone-600">
            <input type="checkbox" name="clearKey" className="h-3 w-3" /> Remove the saved key
          </label>
        ) : null}
      </div>

      <div>
        <label htmlFor="ai-model" className={labelClass}>
          Model
        </label>
        <input
          id="ai-model"
          name="model"
          required
          value={model}
          onChange={(event) => setModel(event.target.value)}
          list="ai-model-options"
          placeholder={preset.suggestedModel || "model name"}
          className={`${inputClass} font-mono`}
          autoComplete="off"
        />
        <datalist id="ai-model-options">
          {(testResult?.models ?? []).map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        <p className="mt-1 text-[10px] text-stone-400">
          {testResult?.models.length ? `${testResult.models.length} models loaded. Start typing to pick one.` : "Test the connection to load available models."}
        </p>
      </div>

      <div>
        <label htmlFor="ai-effort" className={labelClass}>
          Effort {isAnthropic ? "" : "(Claude only)"}
        </label>
        <select
          id="ai-effort"
          name="effort"
          defaultValue={initial.effort}
          disabled={!isAnthropic}
          className={`${inputClass} disabled:opacity-50`}
        >
          {effortLevels.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
        {!isAnthropic ? <input type="hidden" name="effort" value={initial.effort} /> : null}
        <p className="mt-1 text-[10px] leading-relaxed text-stone-400">
          Higher effort can mean better answers on hard questions, at more latency and cost.
        </p>
      </div>

      {testResult ? (
        <div
          role="status"
          className={`sm:col-span-2 rounded-lg px-3 py-2 text-[11.5px] ${
            testResult.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
          }`}
        >
          {testResult.message}
          {testResult.latencyMs != null ? <span className="ml-1 text-[10px] opacity-70">({testResult.latencyMs} ms)</span> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button
          type="submit"
          formAction={testAction}
          disabled={testing}
          className="rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-[11.5px] font-semibold text-stone-800 transition hover:bg-stone-50 disabled:opacity-50"
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
        <button
          type="submit"
          className="rounded-lg bg-stone-900 px-3.5 py-2 text-[11.5px] font-semibold text-white transition hover:bg-stone-800"
        >
          Save connection
        </button>
      </div>
    </form>
  );
}
