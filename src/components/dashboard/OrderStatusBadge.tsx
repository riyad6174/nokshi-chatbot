const STYLES: Record<string, string> = {
  placed: "bg-sky-50 text-sky-700",
  confirmed: "bg-indigo-50 text-indigo-700",
  processing: "bg-amber-50 text-amber-800",
  shipped: "bg-violet-50 text-violet-700",
  delivered: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-stone-100 text-stone-500",
  refunded: "bg-rose-50 text-rose-700",
};

export function OrderStatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STYLES[status] ?? "bg-stone-100 text-stone-600"}`}>
      {label}
    </span>
  );
}
