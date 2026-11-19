import Link from "next/link";
import type { ReactNode } from "react";

/** 1 … 4 5 [6] 7 8 … 20: the first, last and two pages either side of the current one. */
export function pageNumbers(current: number, total: number): Array<number | "gap"> {
  const pages: Array<number | "gap"> = [];
  for (let page = 1; page <= total; page += 1) {
    if (page === 1 || page === total || Math.abs(page - current) <= 2) pages.push(page);
    else if (pages.at(-1) !== "gap") pages.push("gap");
  }
  return pages;
}

/** Page size, the page clamped to what exists, and the rows to skip. */
export function paginate(rawPage: string | undefined, total: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // A page past the end (rows changed meanwhile) shows the last page instead of nothing.
  const page = Math.min(Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1), pageCount);
  return {
    page,
    pageCount,
    skip: (page - 1) * pageSize,
    from: total === 0 ? 0 : (page - 1) * pageSize + 1,
    to: Math.min(page * pageSize, total),
  };
}

export function AdminPagination({
  label,
  page,
  pageCount,
  total,
  from,
  to,
  hrefFor,
}: {
  label: string;
  page: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
  hrefFor: (page: number) => string;
}) {
  if (total === 0) return null;
  return (
    <nav aria-label={label} className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-[11.5px] text-stone-500">
        Showing {from}–{to} of {total}
      </p>
      {pageCount > 1 ? (
        <div className="flex flex-wrap items-center gap-1">
          <PageLink href={hrefFor(page - 1)} disabled={page === 1} label="Previous page">
            ‹ Prev
          </PageLink>
          {pageNumbers(page, pageCount).map((entry, index) =>
            entry === "gap" ? (
              <span key={`gap-${index}`} className="px-1 text-[11.5px] text-stone-400">
                …
              </span>
            ) : (
              <PageLink key={entry} href={hrefFor(entry)} current={entry === page} label={`Page ${entry}`}>
                {entry}
              </PageLink>
            ),
          )}
          <PageLink href={hrefFor(page + 1)} disabled={page === pageCount} label="Next page">
            Next ›
          </PageLink>
        </div>
      ) : null}
    </nav>
  );
}

function PageLink({
  href,
  children,
  label,
  current = false,
  disabled = false,
}: {
  href: string;
  children: ReactNode;
  label: string;
  current?: boolean;
  disabled?: boolean;
}) {
  const base = "min-w-[30px] rounded-lg px-2.5 py-1 text-center text-[11.5px] font-medium";
  if (disabled) {
    return (
      <span aria-disabled className={`${base} cursor-not-allowed text-stone-400 opacity-50`}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      className={`${base} transition ${
        current ? "bg-stone-900 text-white" : "border border-stone-300 text-stone-700 hover:text-stone-900"
      }`}
    >
      {children}
    </Link>
  );
}
