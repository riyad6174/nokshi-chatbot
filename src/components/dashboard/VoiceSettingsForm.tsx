"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { saveVoiceSettingsAction, testVoiceConnectionAction, type ConnectionTestResult } from "@/app/admin/ai-actions";
import { PickOrType } from "@/components/dashboard/PickOrType";

const inputClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[12px] text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none";
const labelClass = "text-[10.5px] font-medium text-stone-500";

const OPENAI_MODELS = [
  { id: "gpt-realtime-2", label: "gpt-realtime-2 (recommended: best Bangla and tool use)" },
  { id: "gpt-realtime", label: "gpt-realtime" },
  { id: "gpt-realtime-mini", label: "gpt-realtime-mini (cheaper, a bit weaker)" },
];
/** Shown until "Test voice" loads the live models this key can actually use. */
const GEMINI_MODELS = [
  { id: "gemini-3.8-live", label: "gemini-3.8-live (recommended: fast, natural)" },
  { id: "gemini-3.8-live-extended-thinking", label: "gemini-3.8-live-extended-thinking (smarter, slower)" },
  { id: "gemini-2.5-flash-native-audio-preview-12-2025", label: "gemini-2.5-flash-native-audio-preview-12-2025" },
];
const OPENAI_VOICES = ["marin", "cedar", "coral", "shimmer", "sage", "alloy", "ash", "ballad", "echo", "verse"];

type Engine = "gemini" | "realtime" | "cascade";

type Props = {
  geminiVoices: Array<{ id: string; label: string; group?: string }>;
  initial: {
    engine: Engine;
    model: string;
    voice: string;
    speed: number;
    style: string;
    keyLast4: string;
    /** Whether the AI model key above can be used for OpenAI voice (an OpenAI key). */
    mainKeyUsable: boolean;
    geminiModel: string;
    geminiVoice: string;
    geminiKeyLast4: string;
    /** Whether the AI model key above can be used for Gemini voice (a Gemini key). */
    mainGeminiKeyUsable: boolean;
  };
};

export function VoiceSettingsForm({ geminiVoices, initial }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [engine, setEngine] = useState<Engine>(initial.engine);
  const [testResult, testAction, testing] = useActionState<ConnectionTestResult | null, FormData>(testVoiceConnectionAction, null);
  const openAiVoices = OPENAI_VOICES.includes(initial.voice) ? OPENAI_VOICES : [initial.voice, ...OPENAI_VOICES];
  const testedGeminiModels = engine === "gemini" ? testResult?.models ?? [] : [];
  const geminiModelOptions = testedGeminiModels.length
    ? testedGeminiModels.map((id) => ({ id, label: GEMINI_MODELS.find((model) => model.id === id)?.label ?? id }))
    : GEMINI_MODELS;

  const openAiKeyHint = initial.keyLast4
    ? `A voice key ending in …${initial.keyLast4} is saved (encrypted). Leave blank to keep it.`
    : initial.mainKeyUsable
      ? "Leave blank to use the OpenAI key from the AI model connection above."
      : "Needed: the AI model above isn't an OpenAI key.";
  const geminiKeyHint = initial.geminiKeyLast4
    ? `A Gemini voice key ending in …${initial.geminiKeyLast4} is saved (encrypted). Leave blank to keep it.`
    : initial.mainGeminiKeyUsable
      ? "Leave blank to use the Gemini key from the AI model connection above."
      : "Needed: paste a Gemini API key, or choose Google Gemini as the AI model provider above.";
  const geminiKeyMissing = !initial.geminiKeyLast4 && !initial.mainGeminiKeyUsable;

  return (
    <form ref={formRef} action={saveVoiceSettingsAction} className="mt-3 grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor="voice-engine" className={labelClass}>
          Voice engine
        </label>
        <select id="voice-engine" name="engine" value={engine} onChange={(event) => setEngine(event.target.value as Engine)} className={inputClass}>
          <option value="gemini">Live voice: Google Gemini Live (recommended)</option>
          <option value="realtime">Live voice: OpenAI Realtime</option>
          <option value="cascade">Classic: speech-to-text → chat model → text-to-speech</option>
        </select>
      </div>

      {/* Both engines' fields stay in the form (hidden when not chosen), so switching never loses them. */}
      <div className={engine === "gemini" ? "contents" : "hidden"}>
        <div className="sm:col-span-2">
          <label htmlFor="gemini-key" className={labelClass}>
            Gemini API key for voice (optional)
          </label>
          <input
            id="gemini-key"
            name="geminiApiKey"
            type="password"
            placeholder={initial.geminiKeyLast4 ? `•••• ${initial.geminiKeyLast4}` : "AIza…"}
            className={`${inputClass} font-mono`}
            autoComplete="off"
            spellCheck={false}
          />
          <p className={`mt-1 text-[10px] leading-relaxed ${geminiKeyMissing ? "text-amber-700" : "text-stone-400"}`}>
            {geminiKeyHint}{" "}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="underline underline-offset-2">
              Get a key
            </a>
          </p>
          {initial.geminiKeyLast4 ? (
            <label className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-stone-600">
              <input type="checkbox" name="clearGeminiKey" className="h-3 w-3" /> Remove the Gemini voice key (use the AI model key)
            </label>
          ) : null}
        </div>

        <div>
          <label htmlFor="gemini-model" className={labelClass}>
            Gemini voice model
          </label>
          <PickOrType
            id="gemini-model"
            name="geminiModel"
            required
            mono
            defaultValue={initial.geminiModel}
            options={geminiModelOptions}
            className={inputClass}
          />
          <p className="mt-1 text-[10px] text-stone-400">
            {testedGeminiModels.length
              ? `${testedGeminiModels.length} live models found for this key.`
              : "Test voice to list exactly the live models your key can use."}
          </p>
        </div>

        <div>
          <label htmlFor="gemini-voice" className={labelClass}>
            Voice
          </label>
          <PickOrType
            id="gemini-voice"
            name="geminiVoice"
            required
            defaultValue={initial.geminiVoice}
            options={geminiVoices}
            className={inputClass}
          />
          <p className="mt-1 text-[10px] text-stone-400">{geminiVoices.length} voices; each one speaks Bangla and English. Test a few on a call.</p>
        </div>
      </div>

      <div className={engine === "realtime" ? "contents" : "hidden"}>
        <div className="sm:col-span-2">
          <label htmlFor="voice-key" className={labelClass}>
            OpenAI API key for voice (optional)
          </label>
          <input
            id="voice-key"
            name="apiKey"
            type="password"
            placeholder={initial.keyLast4 ? `•••• ${initial.keyLast4}` : "sk-…"}
            className={`${inputClass} font-mono`}
            autoComplete="off"
            spellCheck={false}
          />
          <p className={`mt-1 text-[10px] leading-relaxed ${!initial.keyLast4 && !initial.mainKeyUsable ? "text-amber-700" : "text-stone-400"}`}>
            {openAiKeyHint}
          </p>
          {initial.keyLast4 ? (
            <label className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-stone-600">
              <input type="checkbox" name="clearKey" className="h-3 w-3" /> Remove the voice key (use the AI model key)
            </label>
          ) : null}
        </div>

        <div>
          <label htmlFor="voice-model" className={labelClass}>
            Voice model
          </label>
          <PickOrType
            id="voice-model"
            name="model"
            required
            mono
            defaultValue={initial.model}
            options={OPENAI_MODELS}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="voice-voice" className={labelClass}>
            Voice
          </label>
          <select id="voice-voice" name="voice" defaultValue={initial.voice} className={inputClass}>
            {openAiVoices.map((voice) => (
              <option key={voice} value={voice}>
                {voice}
                {voice === "marin" ? " (warm female, recommended)" : voice === "cedar" ? " (warm male)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="voice-speed" className={labelClass}>
            Speaking speed
          </label>
          <input id="voice-speed" name="speed" type="number" step="0.01" min="0.75" max="1.4" defaultValue={initial.speed} className={inputClass} />
          <p className="mt-1 text-[10px] text-stone-400">1 is normal; 1.05–1.15 sounds lively.</p>
        </div>
      </div>
      {/* Speed is an OpenAI setting; keep the saved value when the field is hidden. */}
      {engine !== "realtime" ? <input type="hidden" name="speed" value={initial.speed} /> : null}

      {engine !== "cascade" ? (
        <div className="sm:col-span-2">
          <label htmlFor="voice-style" className={labelClass}>
            How the voice sounds
          </label>
          <textarea
            id="voice-style"
            name="style"
            rows={3}
            maxLength={500}
            defaultValue={initial.style}
            className={inputClass}
            placeholder="e.g. A warm, cheerful young Bangladeshi woman helping a customer on the phone…"
          />
        </div>
      ) : (
        <input type="hidden" name="style" value={initial.style} />
      )}

      {testResult ? (
        <div
          role="status"
          className={`sm:col-span-2 rounded-lg px-3 py-2 text-[11.5px] ${testResult.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}
        >
          {testResult.message}
          {testResult.latencyMs != null ? <span className="ml-1 text-[10px] opacity-70">({testResult.latencyMs} ms)</span> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button
          type="button"
          // Not a form submission: React resets a form after its action runs, which would clear the
          // typed key before Save.
          onClick={() => formRef.current && startTransition(() => testAction(new FormData(formRef.current!)))}
          disabled={testing}
          className="rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-[11.5px] font-semibold text-stone-800 transition hover:bg-stone-50 disabled:opacity-50"
        >
          {testing ? "Testing…" : "Test voice"}
        </button>
        <button type="submit" className="rounded-lg bg-stone-900 px-3.5 py-2 text-[11.5px] font-semibold text-white transition hover:bg-stone-800">
          Save voice settings
        </button>
      </div>
    </form>
  );
}
