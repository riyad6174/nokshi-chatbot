"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * A thin champagne bar along the top that starts the instant an admin link is clicked and finishes
 * when the new page (or its skeleton) arrives, so a click never feels ignored on a slow connection.
 */
export function NavProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/admin")) return;
      // Same page (or just a #hash): nothing will load.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (doneTimer.current) clearTimeout(doneTimer.current);
      setState("loading");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // The URL changed: the new page is on its way in. Finish the bar, then hide it.
  useEffect(() => {
    setState((current) => (current === "loading" ? "done" : current));
    doneTimer.current = setTimeout(() => setState("idle"), 350);
    return () => {
      if (doneTimer.current) clearTimeout(doneTimer.current);
    };
  }, [pathname, searchParams]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px]">
      <div
        className={`h-full origin-left bg-gradient-to-r from-[#b18c4b] via-[#f0dcae] to-[#d8b878] shadow-[0_0_10px_rgba(216,184,120,0.7)] ${
          state === "loading" ? "admin-nav-progress" : state === "done" ? "admin-nav-progress-done" : "opacity-0"
        }`}
      />
    </div>
  );
}
