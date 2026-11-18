const STYLES: Record<string, { pill: string; dot: string }> = {
  placed: { pill: "bg-white/[0.045] text-[#b7b1a6] ring-white/[0.09]", dot: "bg-[#a39d93]" },
  confirmed: { pill: "bg-white/[0.06] text-[#d9d4c9] ring-white/[0.11]", dot: "bg-[#d9d4c9]" },
  processing: { pill: "bg-[#d8b878]/10 text-[#e5c893] ring-[#d8b878]/25", dot: "bg-[#d8b878]" },
  shipped: { pill: "bg-white/[0.045] text-[#cfc9be] ring-white/[0.09]", dot: "bg-[#b7b1a6]" },
  delivered: { pill: "bg-[#6fbf8a]/10 text-[#a7d8b4] ring-[#6fbf8a]/25", dot: "bg-[#6fbf8a]" },
  cancelled: { pill: "bg-white/[0.035] text-[#8a8478] ring-white/[0.07]", dot: "bg-[#7d776e]" },
  refunded: { pill: "bg-[#e16a7b]/10 text-[#fda4af] ring-[#e16a7b]/25", dot: "bg-[#e16a7b]" },
};

export function OrderStatusBadge({ status, label }: { status: string; label: string }) {
  const style = STYLES[status] ?? { pill: "bg-white/[0.035] text-[#8a8478] ring-white/[0.07]", dot: "bg-[#7d776e]" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ${style.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden />
      {label}
    </span>
  );
}
