"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import { ADMIN_NAV, isNavLinkActive, type AdminNavGroup } from "@/components/dashboard/admin-nav-config";

const CLOSED_GROUPS_KEY = "admin.nav.closedGroups";

function readClosedGroups(): string[] {
  try {
    const raw = window.localStorage.getItem(CLOSED_GROUPS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeClosedGroups(ids: string[]) {
  try {
    window.localStorage.setItem(CLOSED_GROUPS_KEY, JSON.stringify(ids));
  } catch {
    // Private mode or blocked storage: the menu still works, it just won't remember.
  }
}

type NavProps = {
  badges?: Record<string, number>;
  /** Icon-only rail (desktop sidebar collapsed). */
  rail?: boolean;
  ariaLabel?: string;
  onNavigate?: () => void;
};

/**
 * Grouped sidebar navigation. Each group opens and closes with a height transition; which groups
 * are closed is remembered per browser. The group holding the current page always opens on arrival.
 */
export function AdminNav({ badges = {}, rail = false, ariaLabel = "Admin", onNavigate }: NavProps) {
  const pathname = usePathname();
  const [closed, setClosed] = useState<string[]>([]);

  useEffect(() => {
    setClosed(readClosedGroups());
  }, []);

  // Arriving on a page inside a closed group opens it.
  useEffect(() => {
    const activeGroup = ADMIN_NAV.find((group) => group.links.some((link) => isNavLinkActive(pathname, link)));
    if (!activeGroup) return;
    setClosed((current) => {
      if (!current.includes(activeGroup.id)) return current;
      const next = current.filter((id) => id !== activeGroup.id);
      writeClosedGroups(next);
      return next;
    });
  }, [pathname]);

  function toggle(group: AdminNavGroup) {
    setClosed((current) => {
      const next = current.includes(group.id) ? current.filter((id) => id !== group.id) : [...current, group.id];
      writeClosedGroups(next);
      return next;
    });
  }

  return (
    <nav aria-label={ariaLabel} className="flex flex-col gap-1">
      {ADMIN_NAV.map((group, index) => {
        const open = rail || !closed.includes(group.id);
        const groupActive = group.links.some((link) => isNavLinkActive(pathname, link));
        const groupBadge = group.links.reduce((sum, link) => sum + (badges[link.href] ?? 0), 0);
        const GroupIcon = group.icon;
        return (
          <div key={group.id}>
            {rail ? (
              index > 0 ? <div className="mx-3 my-2.5 h-px bg-gradient-to-r from-transparent via-white/[0.09] to-transparent" /> : null
            ) : (
              <button
                type="button"
                onClick={() => toggle(group)}
                aria-expanded={open}
                aria-controls={`nav-group-${group.id}`}
                // Readable on the near-black sidebar: at least ~8:1 contrast even when inactive.
                className={`group/head flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                  groupActive ? "text-[#f0dcae]" : "text-[#b7b1a6] hover:text-[#ece8df]"
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-lg border transition-colors ${
                    groupActive
                      ? "border-[#d8b878]/25 bg-[#d8b878]/10 text-[#d8b878]"
                      : "border-white/[0.08] bg-white/[0.04] text-[#b7b1a6] group-hover/head:text-[#ece8df]"
                  }`}
                >
                  <GroupIcon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="flex-1">{group.label}</span>
                {!open && groupBadge > 0 ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#e16a7b]" aria-hidden />
                ) : null}
                <LuChevronDown
                  aria-hidden
                  className={`h-3.5 w-3.5 text-[#958e83] transition-transform duration-300 ease-out ${
                    open ? "rotate-0" : "-rotate-90"
                  }`}
                />
              </button>
            )}

            <div
              id={`nav-group-${group.id}`}
              className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
              inert={!open}
            >
              <ul className={`min-h-0 overflow-hidden ${rail ? "space-y-1" : "space-y-0.5 pt-0.5"}`}>
                {group.links.map((link) => {
                  const active = isNavLinkActive(pathname, link);
                  const badge = badges[link.href] ?? 0;
                  const Icon = link.icon;
                  return (
                    <li key={link.href} className="relative">
                      <Link
                        href={link.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        title={rail ? link.label : undefined}
                        className={`group/link relative flex items-center gap-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d8b878]/50 ${
                          rail ? "mx-auto h-10 w-10 justify-center" : "px-2.5 py-2"
                        } ${
                          active
                            ? "bg-white/[0.08] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 ring-inset ring-white/[0.08]"
                            : "text-[#ddd8ce] hover:bg-white/[0.06] hover:text-white"
                        }`}
                      >
                        {active ? (
                          <span
                            aria-hidden
                            className="absolute -left-px top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-gradient-to-b from-[#f0dcae] to-[#b18c4b] shadow-[0_0_10px_rgba(216,184,120,0.55)]"
                          />
                        ) : null}
                        <Icon
                          aria-hidden
                          className={`h-[17px] w-[17px] shrink-0 transition-colors duration-200 ${
                            active ? "text-[#d8b878]" : "text-[#b7b1a6] group-hover/link:text-[#d8b878]"
                          }`}
                        />
                        <span className={rail ? "sr-only" : "flex-1 truncate"}>{link.label}</span>
                        {badge > 0 ? (
                          rail ? (
                            <span
                              className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#e16a7b] ring-2 ring-[#0a0a0c]"
                              aria-label={`${badge} waiting`}
                            />
                          ) : (
                            <span
                              className="rounded-full bg-[#e16a7b]/15 px-1.5 py-px text-[10px] font-semibold text-[#fda4af] ring-1 ring-inset ring-[#e16a7b]/25"
                              aria-label={`${badge} waiting`}
                            >
                              {badge}
                            </span>
                          )
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
