"use client";

const SUGGESTIONS = [
  "Suggest a backpack under 3,000 taka",
  "Show me wireless earbuds",
  "What is your return policy?",
  "ডেলিভারি চার্জ কত?",
];

export function ChatComposerSuggestions({ onSelect }: { onSelect: (text: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 pl-8">
      {SUGGESTIONS.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onSelect(suggestion)}
          className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-medium text-stone-600 transition hover:border-stone-300 hover:bg-stone-50"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}
