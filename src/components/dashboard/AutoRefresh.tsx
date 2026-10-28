"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

/**
 * Re-renders the current server page on an interval while the tab is visible (live inbox).
 * Skips a tick while the previous refresh is still rendering, so a slow server doesn't get a pile-up
 * of overlapping refreshes (which makes the page flicker and buttons hard to click).
 */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || pendingRef.current) return;
      startTransition(() => router.refresh());
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}
