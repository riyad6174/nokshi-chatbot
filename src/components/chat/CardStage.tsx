"use client";

import { useEffect, useState, type ReactNode } from "react";

const WIDE_QUERY = "(min-width: 1024px)";

function useWideScreen(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

/**
 * Cards over a blurred page; the blur is only there while cards are shown. The voice panel stays
 * sharp (it sits between the blur and the cards).
 *
 * Wide screens: products fill the space from the left of the screen; the cart, forms and order cards
 * sit right beside the voice panel, bottom-aligned with it. Smaller screens: both in the space above
 * the voice panel. Tap the background, the close button or press Escape to hide them.
 */
export function CardStage({
  open,
  position,
  products,
  panel,
  onClose,
}: {
  open: boolean;
  position: "left" | "right";
  /** The product grid (or a single product), or null. */
  products: ReactNode;
  /** Cart, details form, order summary or placed order, or null. */
  panel: ReactNode;
  onClose: () => void;
}) {
  const wide = useWideScreen();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const visibility = open ? "opacity-100" : "pointer-events-none opacity-0";
  const lift = open ? "translate-y-0" : "translate-y-3";
  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      tabIndex={open ? 0 : -1}
      aria-label="Close"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-stone-700 ring-1 ring-black/5 transition hover:rotate-90 hover:bg-stone-50"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );
  // Screen side the voice panel is on, and the opposite one.
  const dockSide = position === "left" ? "left" : "right";
  const freeSide = position === "left" ? "right" : "left";

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        onClick={onClose}
        aria-label="Hide cards"
        className={`fixed inset-0 z-[45] cursor-default bg-stone-950/35 backdrop-blur-md transition-opacity duration-300 ${visibility}`}
      />

      {wide ? (
        <>
          {products ? (
            <div
              role="dialog"
              aria-label="Products"
              aria-hidden={!open}
              className={`chat-scroll fixed bottom-6 top-6 z-[55] overflow-y-auto transition duration-300 ease-out ${visibility} ${lift}`}
              // From the free side of the screen up to the panel column (or the voice panel itself).
              style={{ [freeSide]: "2rem", [dockSide]: panel ? "calc(380px + 420px + 4rem)" : "calc(380px + 3.5rem)" }}
            >
              <div className="flex min-h-full flex-col justify-center py-2">
                {panel ? null : <div className="mb-1 flex justify-end">{closeButton}</div>}
                {products}
              </div>
            </div>
          ) : null}
          {panel ? (
            <div
              role="dialog"
              aria-label="Your order"
              aria-hidden={!open}
              className={`chat-scroll fixed bottom-[5.75rem] z-[55] flex max-h-[calc(100dvh-7.5rem)] w-[420px] flex-col gap-3 overflow-y-auto transition duration-300 ease-out ${visibility} ${lift}`}
              style={{ [dockSide]: "calc(1.5rem + 380px + 1rem)" }}
            >
              <div className="mt-auto flex justify-end">{closeButton}</div>
              {panel}
            </div>
          ) : null}
        </>
      ) : (
        <div
          role="dialog"
          aria-label="Products and order"
          aria-hidden={!open}
          className={`chat-scroll fixed inset-x-3 top-3 z-[55] flex flex-col gap-3 overflow-y-auto transition duration-300 ease-out sm:inset-x-6 ${visibility} ${lift}`}
          // Down to just above the voice panel (bottom offset + its measured height).
          style={{ bottom: "calc(5.75rem + var(--voice-dock-h, 26rem) + 0.75rem)" }}
        >
          <div className="sticky top-0 z-10 flex justify-end">{closeButton}</div>
          {panel}
          {products}
        </div>
      )}
    </>
  );
}
