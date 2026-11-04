"use client";

import { useActionState } from "react";
import { saveVoiceSettingsAction, testVoiceConnectionAction, type ConnectionTestResult } from "@/app/admin/ai-actions";

const inputClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[12px] text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none";
const labelClass = "text-[10.5px] font-medium text-stone-500";

const MODELS = [
  { id: "gpt-realtime-2", label: "gpt-realtime-2 (recommended: best Bangla and tool use)" },
  { id: "gpt-realtime", label: "gpt-realtime" },
  { id: "gpt-realtime-mini", label: "gpt-realtime-mini (cheaper, a bit weaker)" },
];
const VOICES = ["marin", "cedar", "coral", "shimmer", "sage", "alloy", "ash", "ballad", "echo", "verse"];

type Props = {
  initial: {
    engine: "realtime" | "cascade";
    model: string;
    voice: string;
    speed: number;
    style: string;
    keyLast4: string;
    /** Whether the AI model key above can be used for voice (an OpenAI key). */
    mainKeyUsable: boolean;
  };
};

export function VoiceSettingsForm({ initial }: Props) {
  const [testResult, testAction, testing] = useActionState<ConnectionTestResult | null, FormData>(testVoiceConnectionAction, null);
  const voices = VOICES.includes(initial.voice) ? VOICES : [initial.voice, ...VOICES];

  const keyHint = initial.keyLast4
    ? `A voice key ending in …${initial.keyLast4} is saved (encrypted). Leave blank to keep it.`
    : initial.mainKeyUsable
      ? "Leave blank to use the OpenAI key from the AI model connection above."
      : "Needed: the AI model above isn't an OpenAI key, and live voice only runs on OpenAI.";

  return (
    <form action={saveVoiceSettingsAction} className="mt-3 grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor="voice-engine" className={labelClass}>
          Voice engine
        </label>
        <select id="voice-engine" name="engine" defaultValue={initial.engine} className={inputClass}>
          <option value="realtime">Live voice: OpenAI Realtime (fastest, most natural)</option>
          <option value="cascade">Classic: speech-to-text → chat model → text-to-speech</option>
        </select>
      </div>

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
          {keyHint}
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
        <input
          id="voice-model"
          name="model"
          required
          defaultValue={initial.model}
          list="voice-model-options"
          className={`${inputClass} font-mono`}
          autoComplete="off"
        />
        <datalist id="voice-model-options">
          {MODELS.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </datalist>
        <p className="mt-1 text-[10px] text-stone-400">gpt-realtime-2 is recommended. Clear the box to see the options.</p>
      </div>

      <div>
        <label htmlFor="voice-voice" className={labelClass}>
          Voice
        </label>
        <select id="voice-voice" name="voice" defaultValue={initial.voice} className={inputClass}>
          {voices.map((voice) => (
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
        <input
          id="voice-speed"
          name="speed"
          type="number"
          step="0.01"
          min="0.75"
          max="1.4"
          defaultValue={initial.speed}
          className={inputClass}
        />
        <p className="mt-1 text-[10px] text-stone-400">1 is normal; 1.05–1.15 sounds lively.</p>
      </div>

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
          type="submit"
          formAction={testAction}
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
