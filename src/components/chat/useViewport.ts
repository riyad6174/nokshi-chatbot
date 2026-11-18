"use client";

import { useEffect, useState } from "react";

/** False on the server and first render; the widget only shows after a tap, so nothing flashes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/**
 * Publishes the part of the screen the on-screen keyboard leaves free (--vv-top and --vv-bottom, in
 * px), so panels pinned to the bottom of the screen sit above the keyboard instead of behind it.
 */
export function useVisualViewportVars(enabled: boolean) {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) return;
    const root = document.documentElement;
    const clear = () => {
      root.style.removeProperty("--vv-top");
      root.style.removeProperty("--vv-bottom");
    };
    const update = () => {
      // Pinch zoom also shrinks the visual viewport, but the panels shouldn't move for it.
      if (viewport.scale > 1.01) return clear();
      const top = Math.max(0, viewport.offsetTop);
      const bottom = Math.max(0, root.clientHeight - viewport.height - viewport.offsetTop);
      root.style.setProperty("--vv-top", `${Math.round(top)}px`);
      root.style.setProperty("--vv-bottom", `${Math.round(bottom)}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      clear();
    };
  }, [enabled]);
}
