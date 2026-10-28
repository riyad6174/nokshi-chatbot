const LABELS: Record<string, { label: string; className: string }> = {
  waiting_human: { label: "Needs a person", className: "bg-red-50 text-red-700 ring-1 ring-red-200" },
  human: { label: "With team", className: "bg-violet-50 text-violet-700" },
  bot: { label: "AI", className: "bg-emerald-50 text-emerald-700" },
  closed: { label: "Closed", className: "bg-stone-100 text-stone-500" },
};

export function ConversationStatusBadge({ status }: { status: string }) {
  const entry = LABELS[status] ?? LABELS.bot!;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${entry.className}`}>{entry.label}</span>;
}
