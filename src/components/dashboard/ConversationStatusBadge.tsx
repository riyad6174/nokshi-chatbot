const LABELS: Record<string, { label: string; className: string; dot: string }> = {
  waiting_human: {
    label: "Needs a person",
    className: "bg-[#e16a7b]/10 text-[#fda4af] ring-[#e16a7b]/25",
    dot: "bg-[#e16a7b] animate-pulse",
  },
  human: {
    label: "With team",
    className: "bg-[#d8b878]/10 text-[#e5c893] ring-[#d8b878]/25",
    dot: "bg-[#d8b878]",
  },
  bot: {
    label: "AI",
    className: "bg-white/[0.045] text-[#cfc9be] ring-white/[0.09]",
    dot: "bg-[#d8b878]",
  },
  closed: {
    label: "Closed",
    className: "bg-white/[0.035] text-[#8a8478] ring-white/[0.07]",
    dot: "bg-[#7d776e]",
  },
};

export function ConversationStatusBadge({ status }: { status: string }) {
  const entry = LABELS[status] ?? LABELS.bot!;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ${entry.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${entry.dot}`} aria-hidden />
      {entry.label}
    </span>
  );
}
