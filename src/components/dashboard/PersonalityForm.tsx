"use client";

import { useState } from "react";
import { savePersonalityAction } from "@/app/admin/chatbot-actions";

const inputClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[12px] text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none";
const labelClass = "text-[10.5px] font-medium text-stone-500";

type Topic = { label: string; prompt: string };

type Props = {
  tones: Record<string, string>;
  styles: Record<string, string>;
  initial: {
    assistantName: string;
    tone: string;
    customTone: string;
    conversationStyle: string;
    welcomeMessage: string;
    productGreeting: string;
    fallbackMessage: string;
    systemInstructions: string;
    topics: Topic[];
  };
};

const STYLE_LABELS: Record<string, string> = {
  straightforward: "Straightforward: short, direct answers",
  explainer: "Explainer: compares options and explains why",
  consultative: "Consultative: asks questions like a personal shopper",
};

export function PersonalityForm({ tones, styles, initial }: Props) {
  const [tone, setTone] = useState(initial.tone);
  const [style, setStyle] = useState(initial.conversationStyle);
  const [topics, setTopics] = useState<Topic[]>(initial.topics.length > 0 ? initial.topics : [{ label: "", prompt: "" }]);

  const updateTopic = (index: number, patch: Partial<Topic>) =>
    setTopics((current) => current.map((topic, position) => (position === index ? { ...topic, ...patch } : topic)));

  return (
    <form action={savePersonalityAction} className="mt-3 grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="assistantName" className={labelClass}>
          Assistant name
        </label>
        <input id="assistantName" name="assistantName" required defaultValue={initial.assistantName} className={inputClass} />
      </div>

      <div>
        <label htmlFor="tone" className={labelClass}>
          Tone
        </label>
        <select id="tone" name="tone" value={tone} onChange={(event) => setTone(event.target.value)} className={inputClass}>
          {Object.keys(tones).map((key) => (
            <option key={key} value={key}>
              {key[0]!.toUpperCase() + key.slice(1)}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
        <p className="mt-1 text-[10px] leading-relaxed text-stone-400">{tone === "custom" ? "Describe it below." : tones[tone]}</p>
      </div>

      {tone === "custom" ? (
        <div className="sm:col-span-2 animate-fade-up">
          <label htmlFor="customTone" className={labelClass}>
            Custom tone
          </label>
          <textarea
            id="customTone"
            name="customTone"
            rows={2}
            defaultValue={initial.customTone}
            placeholder="e.g. Speak like a friendly older sibling; mix English and Bangla naturally."
            className={inputClass}
          />
        </div>
      ) : (
        <input type="hidden" name="customTone" value={initial.customTone} />
      )}

      <fieldset className="sm:col-span-2">
        <legend className={labelClass}>Conversation type</legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-3">
          {Object.keys(styles).map((key) => (
            <label
              key={key}
              className={`cursor-pointer rounded-xl border p-2.5 text-[11.5px] transition ${
                style === key ? "border-stone-900 bg-stone-50 text-stone-900" : "border-stone-200 text-stone-600 hover:border-stone-300"
              }`}
            >
              <span className="flex items-center gap-1.5 font-semibold">
                <input type="radio" name="conversationStyle" value={key} checked={style === key} onChange={() => setStyle(key)} />
                {key[0]!.toUpperCase() + key.slice(1)}
              </span>
              <span className="mt-0.5 block text-[10.5px] text-stone-500">{STYLE_LABELS[key]?.split(": ")[1] ?? styles[key]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="sm:col-span-2">
        <label htmlFor="welcomeMessage" className={labelClass}>
          Greeting (home page and other pages)
        </label>
        <textarea id="welcomeMessage" name="welcomeMessage" required rows={2} defaultValue={initial.welcomeMessage} className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="productGreeting" className={labelClass}>
          Greeting on a product page. {"{product}"} is replaced with the product name; a factual overview follows automatically.
        </label>
        <input
          id="productGreeting"
          name="productGreeting"
          defaultValue={initial.productGreeting}
          placeholder="Hi! I see you're looking at {product}. Here's a quick overview."
          className={inputClass}
        />
      </div>

      <fieldset className="sm:col-span-2">
        <legend className={labelClass}>Suggested topic badges (shown when the chat opens)</legend>
        <div className="mt-1 space-y-2">
          {topics.map((topic, index) => (
            <div key={index} className="flex gap-2 animate-fade-up">
              <input
                name={`topic_label_${index}`}
                value={topic.label}
                onChange={(event) => updateTopic(index, { label: event.target.value })}
                placeholder="Badge text, e.g. Delivery time"
                aria-label={`Topic ${index + 1} badge text`}
                maxLength={40}
                className={`${inputClass} mt-0 w-2/5`}
              />
              <input
                name={`topic_prompt_${index}`}
                value={topic.prompt}
                onChange={(event) => updateTopic(index, { prompt: event.target.value })}
                placeholder="Message sent when tapped"
                aria-label={`Topic ${index + 1} message`}
                maxLength={200}
                className={`${inputClass} mt-0 flex-1`}
              />
              <button
                type="button"
                onClick={() => setTopics((current) => current.filter((_, position) => position !== index))}
                aria-label={`Remove topic ${index + 1}`}
                className="shrink-0 rounded-lg border border-stone-200 px-2 text-[12px] text-stone-500 hover:bg-stone-50"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {topics.length < 8 ? (
          <button
            type="button"
            onClick={() => setTopics((current) => [...current, { label: "", prompt: "" }])}
            className="mt-2 text-[11px] font-semibold text-stone-700 underline underline-offset-2"
          >
            + Add a topic
          </button>
        ) : null}
      </fieldset>

      <div className="sm:col-span-2">
        <label htmlFor="systemInstructions" className={labelClass}>
          Business instructions (what the assistant should know or always do)
        </label>
        <textarea
          id="systemInstructions"
          name="systemInstructions"
          rows={5}
          defaultValue={initial.systemInstructions}
          placeholder="e.g. We're a Dhaka-based lifestyle store. Always mention free delivery over 3,000 BDT. Never promise same-day delivery."
          className={inputClass}
        />
        <p className="mt-1 text-[10px] text-stone-400">Policies and FAQs go in Knowledge so the assistant can quote them.</p>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="fallbackMessage" className={labelClass}>
          Fallback message (when the assistant can&apos;t answer)
        </label>
        <textarea id="fallbackMessage" name="fallbackMessage" required rows={2} defaultValue={initial.fallbackMessage} className={inputClass} />
      </div>

      <div className="sm:col-span-2">
        <button type="submit" className="rounded-lg bg-stone-900 px-3.5 py-2 text-[11.5px] font-semibold text-white transition hover:bg-stone-800">
          Save personality
        </button>
      </div>
    </form>
  );
}
