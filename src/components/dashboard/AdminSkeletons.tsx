// Loading skeletons for admin pages (used by the route `loading.tsx` files). They mirror each page's
// layout, so the frame appears the moment a link is clicked and the data fills in without a jump.
// Server components: no client JavaScript.

import type { ReactNode } from "react";

export function Bone({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`admin-skeleton block ${className}`} />;
}

/** Wraps a skeleton page: announces loading once to screen readers and hides the bones from them. */
export function SkeletonPage({ label = "Loading", children }: { label?: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}…</span>
      <div aria-hidden>{children}</div>
    </div>
  );
}

export function HeaderSkeleton({ action = false, pills = 0 }: { action?: boolean; pills?: number }) {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-md space-y-2.5">
          <Bone className="h-7 w-44" />
          <Bone className="h-3 w-full max-w-sm" />
        </div>
        {action ? <Bone className="h-9 w-32 rounded-xl" /> : null}
      </div>
      {pills > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {Array.from({ length: pills }, (_, index) => (
            <Bone key={index} className={`h-6 rounded-full ${index === 0 ? "w-14" : "w-20"}`} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function StatTilesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={`mt-4 grid gap-3 sm:grid-cols-2 ${count >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-xl border border-stone-200 bg-white p-4">
          <Bone className="h-3 w-24" />
          <Bone className="mt-3 h-7 w-28" />
          <Bone className="mt-3 h-2.5 w-36" />
        </div>
      ))}
    </div>
  );
}

const WIDTHS = ["w-24", "w-32", "w-16", "w-20", "w-28", "w-14"];

export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-stone-200 bg-white">
      <div className="flex gap-6 border-b border-stone-200 px-3 py-3">
        {Array.from({ length: columns }, (_, column) => (
          <Bone key={column} className={`h-2.5 ${column === 0 ? "w-20" : "w-14"} ${column > 3 ? "hidden sm:block" : ""}`} />
        ))}
      </div>
      <div className="divide-y divide-stone-100">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center gap-6 px-3 py-3.5">
            {Array.from({ length: columns }, (_, column) => (
              <div key={column} className={`flex-1 space-y-1.5 ${column > 3 ? "hidden sm:block" : ""}`}>
                <Bone className={`h-3 ${WIDTHS[(row + column) % WIDTHS.length]}`} />
                {column < 2 ? <Bone className="h-2.5 w-16 opacity-60" /> : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PaginationSkeleton() {
  return (
    <div className="mt-3 flex items-center justify-between gap-2">
      <Bone className="h-3 w-32" />
      <div className="flex gap-1">
        {Array.from({ length: 5 }, (_, index) => (
          <Bone key={index} className="h-7 w-8 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

/** Conversation and inbox rows: avatar, name, preview, time. */
export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="mt-4 divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-3 px-4 py-3.5">
          <Bone className="h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Bone className={`h-3 ${WIDTHS[row % WIDTHS.length]}`} />
            <Bone className={`h-2.5 ${row % 2 ? "w-3/4" : "w-1/2"} max-w-md`} />
          </div>
          <Bone className="h-5 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = "h-48" }: { height?: string }) {
  const bars = [40, 65, 50, 80, 55, 90, 70, 60, 85, 45, 75, 95];
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <Bone className="h-3 w-32" />
      <div className={`mt-4 flex items-end gap-2 ${height}`}>
        {bars.map((value, index) => (
          <span key={index} className="admin-skeleton block flex-1 rounded-md" style={{ height: `${value}%` }} />
        ))}
      </div>
    </div>
  );
}

/** Settings and editor pages: labelled fields in a few cards. */
export function FormSkeleton({ sections = 2, fields = 4 }: { sections?: number; fields?: number }) {
  return (
    <div className="mt-5 space-y-4">
      {Array.from({ length: sections }, (_, section) => (
        <div key={section} className="rounded-xl border border-stone-200 bg-white p-5">
          <Bone className="h-4 w-40" />
          <Bone className="mt-2 h-2.5 w-64 max-w-full" />
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: fields }, (_, field) => (
              <div key={field} className={field === fields - 1 && fields % 2 ? "sm:col-span-2" : ""}>
                <Bone className="h-2.5 w-24" />
                <Bone className="mt-2 h-9 w-full rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      ))}
      <Bone className="h-9 w-28 rounded-xl" />
    </div>
  );
}

/** A record page: main card with lines, side card with facts. */
export function DetailSkeleton() {
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <Bone className="h-4 w-36" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center gap-3">
                <Bone className="h-10 w-10 shrink-0 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Bone className={`h-3 ${WIDTHS[index]}`} />
                  <Bone className="h-2.5 w-20 opacity-60" />
                </div>
                <Bone className="h-3 w-16" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <Bone className="h-4 w-28" />
          <Bone className="mt-4 h-2.5 w-full" />
          <Bone className="mt-2 h-2.5 w-5/6" />
          <Bone className="mt-2 h-2.5 w-2/3" />
        </div>
      </div>
      <div className="space-y-4">
        {Array.from({ length: 2 }, (_, card) => (
          <div key={card} className="rounded-xl border border-stone-200 bg-white p-5">
            <Bone className="h-4 w-24" />
            {Array.from({ length: 4 }, (_, line) => (
              <div key={line} className="mt-3 flex justify-between gap-3">
                <Bone className="h-2.5 w-16" />
                <Bone className={`h-2.5 ${WIDTHS[(card + line) % WIDTHS.length]}`} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A chat thread: alternating bubbles and a composer. */
export function ThreadSkeleton() {
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <div className="space-y-4">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className={`flex ${index % 2 ? "justify-end" : "justify-start"}`}>
              <Bone className={`h-10 rounded-2xl ${["w-2/3", "w-1/2", "w-3/5", "w-2/5", "w-1/2", "w-1/3"][index]}`} />
            </div>
          ))}
        </div>
        <Bone className="mt-6 h-11 w-full rounded-xl" />
      </div>
      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <Bone className="h-4 w-24" />
        {Array.from({ length: 5 }, (_, line) => (
          <div key={line} className="mt-3 flex justify-between gap-3">
            <Bone className="h-2.5 w-16" />
            <Bone className={`h-2.5 ${WIDTHS[line]}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
