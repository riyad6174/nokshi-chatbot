"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  LuBell,
  LuChevronRight,
  LuExternalLink,
  LuLogOut,
  LuMenu,
  LuPanelLeftClose,
  LuPanelLeftOpen,
  LuSettings,
  LuSparkles,
  LuX,
} from "react-icons/lu";
import { logoutAction } from "@/app/admin/auth-actions";
import { AdminNav } from "@/components/dashboard/AdminNav";
import { NavProgress } from "@/components/dashboard/NavProgress";
import { ADMIN_NAV, findNavLocation, isNavLinkActive } from "@/components/dashboard/admin-nav-config";

const RAIL_KEY = "admin.sidebar.rail";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d8b878]/50 focus-visible:ring-offset-0";

function initials(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return (parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "A").slice(0, 2);
}

function Brand({ compact }: { compact: boolean }) {
  return (
    <Link href="/admin" className="group flex min-w-0 items-center gap-3">
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f3e1b8] via-[#d8b878] to-[#b18c4b] text-[#191307] shadow-[0_10px_24px_-12px_rgba(216,184,120,0.85)] ring-1 ring-inset ring-white/40 transition-transform duration-300 group-hover:scale-[1.04]">
        <LuSparkles className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span
        className={`min-w-0 overflow-hidden transition-all duration-300 ${
          compact ? "pointer-events-none w-0 opacity-0" : "w-auto opacity-100"
        }`}
      >
        <span className="block truncate text-[14.5px] font-semibold tracking-tight text-[#f3f0e9]">Nokshi</span>
        <span className="mt-0.5 block text-[9.5px] font-medium uppercase tracking-[0.24em] text-[#b7b1a6]">
          Admin console
        </span>
      </span>
    </Link>
  );
}

/** Decorative background: deep charcoal with two barely-there light fields. */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_-20%,#141317_0%,#0a0a0c_45%,#060607_100%)]" />
      <div className="admin-blob absolute -left-40 -top-48 h-[560px] w-[560px] rounded-full bg-[#d8b878]/[0.07] blur-[120px]" />
      <div className="admin-blob absolute -right-52 top-1/4 h-[520px] w-[520px] rounded-full bg-[#8a8fa0]/[0.05] blur-[120px] [animation-delay:-8s]" />
      <div className="admin-blob absolute bottom-[-220px] left-1/3 h-[520px] w-[520px] rounded-full bg-[#b18c4b]/[0.05] blur-[120px] [animation-delay:-14s]" />
      <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_at_50%_0%,black,transparent_72%)]" />
    </div>
  );
}

function IconButton({
  label,
  onClick,
  className = "",
  children,
}: {
  label: string;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-[#cfc9be] transition hover:border-white/[0.14] hover:bg-white/[0.08] hover:text-[#f3f0e9] ${FOCUS_RING} ${className}`}
    >
      {children}
    </button>
  );
}

export function AdminShell({
  user,
  storeName,
  waiting,
  children,
}: {
  user: { email: string; name: string | null };
  storeName: string | null;
  waiting: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [rail, setRail] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const badges = { "/admin/inbox": waiting };
  const location = findNavLocation(pathname);
  const displayName = user.name || user.email;

  useEffect(() => {
    try {
      setRail(window.localStorage.getItem(RAIL_KEY) === "1");
    } catch {
      // Storage blocked: start expanded.
    }
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [drawerOpen]);

  function toggleRail() {
    setRail((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(RAIL_KEY, next ? "1" : "0");
      } catch {
        // Not remembered; fine.
      }
      return next;
    });
  }

  const allLinks = ADMIN_NAV.flatMap((group) => group.links);

  return (
    <div className="admin-ui relative min-h-screen">
      <Backdrop />
      <Suspense fallback={null}>
        <NavProgress />
      </Suspense>

      {/* Desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden flex-col bg-[#0a0a0c]/80 backdrop-blur-2xl backdrop-saturate-150 transition-[width] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] md:flex ${
          rail ? "w-[84px]" : "w-[272px]"
        }`}
      >
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-white/[0.09] to-transparent" />

        <div className={`flex h-[68px] items-center ${rail ? "justify-center px-2" : "justify-between px-4"}`}>
          <Brand compact={rail} />
          {!rail ? (
            <button
              type="button"
              onClick={toggleRail}
              className={`flex h-8 w-8 items-center justify-center rounded-lg text-[#b7b1a6] transition hover:bg-white/[0.06] hover:text-[#f3f0e9] ${FOCUS_RING}`}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <LuPanelLeftClose className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="admin-scroll flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-3">
          <AdminNav badges={badges} rail={rail} />
        </div>

        <div className="p-3">
          {rail ? (
            <button
              type="button"
              onClick={toggleRail}
              className={`mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-[#cfc9be] transition hover:bg-white/[0.08] hover:text-[#f3f0e9] ${FOCUS_RING}`}
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <LuPanelLeftOpen className="h-[18px] w-[18px]" />
            </button>
          ) : (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <p className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.2em] text-[#b7b1a6]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#d8b878] shadow-[0_0_10px_rgba(216,184,120,0.7)]" />
                Store
              </p>
              <p className="mt-1.5 truncate text-[12.5px] font-semibold text-[#ece8df]">{storeName ?? "Not configured"}</p>
              <Link
                href="/"
                target="_blank"
                className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-[#b7b1a6] transition hover:text-[#f0dcae]"
              >
                Open storefront <LuExternalLink className="h-3 w-3" aria-hidden />
              </Link>
            </div>
          )}
        </div>
      </aside>

      <div
        className={`flex min-h-screen flex-col transition-[padding] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
          rail ? "md:pl-[84px]" : "md:pl-[272px]"
        }`}
      >
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#070708]/75 backdrop-blur-2xl backdrop-saturate-150">
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d8b878]/35 to-transparent" />
          <div className="flex h-[68px] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <IconButton label="Open menu" onClick={() => setDrawerOpen(true)} className="md:hidden">
              <LuMenu className="h-[18px] w-[18px]" />
            </IconButton>
            <div className="md:hidden">
              <Brand compact />
            </div>

            <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-[12.5px] md:flex">
              {location ? (
                <>
                  <span className="text-[#b7b1a6]">{location.group.label}</span>
                  <LuChevronRight className="h-3.5 w-3.5 text-[#4f4b45]" aria-hidden />
                  <span className="flex items-center gap-2 truncate font-medium text-[#f3f0e9]">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-[#d8b878]/20 bg-[#d8b878]/10 text-[#d8b878]">
                      <location.link.icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    {location.link.label}
                  </span>
                </>
              ) : (
                <span className="font-medium text-[#f3f0e9]">Admin</span>
              )}
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <Link
                href="/"
                target="_blank"
                className={`hidden items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] font-medium text-[#b7b1a6] transition hover:border-white/[0.14] hover:bg-white/[0.08] hover:text-[#f3f0e9] sm:flex ${FOCUS_RING}`}
              >
                <LuExternalLink className="h-3.5 w-3.5" aria-hidden />
                View store
              </Link>
              <Link
                href="/admin/inbox?filter=attention"
                className={`relative flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-[#cfc9be] transition hover:border-white/[0.14] hover:bg-white/[0.08] hover:text-[#f3f0e9] ${FOCUS_RING}`}
                aria-label={waiting > 0 ? `${waiting} chats waiting for a person` : "No chats waiting"}
                title="Chats waiting for a person"
              >
                <LuBell className="h-[17px] w-[17px]" aria-hidden />
                {waiting > 0 ? (
                  <>
                    <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#e16a7b] px-1 text-[9.5px] font-bold text-[#1c0c10] ring-2 ring-[#0a0a0c]">
                      {waiting > 99 ? "99+" : waiting}
                    </span>
                    <span className="absolute -right-1 -top-1 h-[18px] w-[18px] animate-ping rounded-full bg-[#e16a7b]/40" />
                  </>
                ) : null}
              </Link>

              <span aria-hidden className="mx-0.5 hidden h-6 w-px bg-white/[0.08] sm:block" />

              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  className={`flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] py-1 pl-1 pr-2.5 transition hover:border-white/[0.14] hover:bg-white/[0.08] ${FOCUS_RING}`}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#f3e1b8] via-[#d8b878] to-[#b18c4b] text-[11px] font-bold text-[#191307]">
                    {initials(displayName)}
                  </span>
                  <span className="hidden max-w-[160px] truncate text-[12px] font-medium text-[#d9d4c9] lg:block">
                    {displayName}
                  </span>
                </button>
                <div
                  role="menu"
                  className={`absolute right-0 top-[calc(100%+10px)] w-60 origin-top-right rounded-2xl border border-white/[0.09] bg-[#0e0e11]/95 p-1.5 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.95)] backdrop-blur-2xl transition duration-200 ${
                    menuOpen ? "visible translate-y-0 scale-100 opacity-100" : "invisible -translate-y-1 scale-95 opacity-0"
                  }`}
                >
                  <div className="px-3 py-2">
                    <p className="truncate text-[12.5px] font-semibold text-[#f3f0e9]">{user.name || "Admin"}</p>
                    <p className="truncate text-[11px] text-[#b7b1a6]">{user.email}</p>
                  </div>
                  <div className="my-1 h-px bg-white/[0.07]" />
                  <Link
                    href="/admin/settings"
                    role="menuitem"
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] text-[#d9d4c9] transition hover:bg-white/[0.06] hover:text-[#f3f0e9]"
                  >
                    <LuSettings className="h-3.5 w-3.5" aria-hidden />
                    Store settings
                  </Link>
                  <form action={logoutAction}>
                    <button
                      type="submit"
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-medium text-[#fda4af] transition hover:bg-[#e16a7b]/10"
                    >
                      <LuLogOut className="h-3.5 w-3.5" aria-hidden />
                      Sign out
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>

          {/* Phones: every page one swipe away. */}
          <nav aria-label="Admin" className="admin-scroll -mt-1 flex gap-1.5 overflow-x-auto px-4 pb-2.5 md:hidden">
            {allLinks.map((link) => {
              const active = isNavLinkActive(pathname, link);
              const badge = badges[link.href as keyof typeof badges] ?? 0;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition ${
                    active
                      ? "border-[#d8b878]/30 bg-[#d8b878]/[0.12] text-[#f0dcae]"
                      : "border-white/[0.08] bg-white/[0.04] text-[#cfc9be]"
                  }`}
                >
                  <link.icon className="h-3.5 w-3.5" aria-hidden />
                  {link.label}
                  {badge > 0 ? (
                    <span className="rounded-full bg-[#e16a7b] px-1.5 text-[9.5px] font-bold text-[#1c0c10]">{badge}</span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </header>

        <main key={pathname} className="admin-main mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>

      {/* Mobile drawer */}
      <div className={`fixed inset-0 z-50 md:hidden ${drawerOpen ? "" : "pointer-events-none"}`} inert={!drawerOpen}>
        <div
          className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
            drawerOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={`absolute inset-y-0 left-0 flex w-[min(300px,86vw)] flex-col border-r border-white/[0.08] bg-[#0a0a0c]/95 shadow-[0_0_80px_rgba(0,0,0,0.9)] backdrop-blur-2xl transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-[68px] items-center justify-between border-b border-white/[0.06] px-4">
            <Brand compact={false} />
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className={`flex h-9 w-9 items-center justify-center rounded-xl text-[#cfc9be] transition hover:bg-white/[0.06] hover:text-[#f3f0e9] ${FOCUS_RING}`}
              aria-label="Close menu"
            >
              <LuX className="h-[18px] w-[18px]" />
            </button>
          </div>
          <div className="admin-scroll flex-1 overflow-y-auto px-3 py-4">
            <AdminNav badges={badges} ariaLabel="Admin menu" onNavigate={() => setDrawerOpen(false)} />
          </div>
          <div className="border-t border-white/[0.06] p-3">
            <p className="px-2 text-[9.5px] font-semibold uppercase tracking-[0.2em] text-[#b7b1a6]">Store</p>
            <p className="mt-1 truncate px-2 text-[12px] font-semibold text-[#ece8df]">{storeName ?? "Not configured"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
