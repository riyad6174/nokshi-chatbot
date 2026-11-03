"use client";

import { useEffect, type ReactNode } from "react";

/**
 * Products, cart and order cards shown in the middle of the screen over a stronger blur, so they get
 * the customer's full attention. The voice panel stays sharp above the blur (it sits between the
 * two layers). On wide screens the cards use the space left of the panel. Tap the background, the
 * close button or press Escape to hide them; the panel can show them again.
 */
export function CardStage({
  open,
  wide,
  position,
  onClose,
  children,
}: {
  open: boolean;
  /** A product grid: use the full width. Otherwise a comfortable reading width. */
  wide: boolean;
  position: "left" | "right";
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        onClick={onClose}
        aria-label="Hide cards"
        className={`fixed inset-0 z-[45] cursor-default bg-stone-950/30 backdrop-blur-md transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <div
        aria-hidden={!open}
        className={`pointer-events-none fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto px-3 pb-24 pt-6 transition-opacity duration-300 sm:px-6 sm:pb-6 ${
          position === "left" ? "lg:pl-[26rem]" : "lg:pr-[26rem]"
        } ${open ? "opacity-100" : "opacity-0"}`}
      >
        <div
          role="dialog"
          aria-label="Products and order"
          // Phones: at the top, clear of the panel. Larger screens: centred (my-auto), yet a tall
          // stack can still scroll to its top.
          className={`relative mt-1 w-full ${wide ? "max-w-[720px]" : "max-w-[480px]"} transition sm:my-auto duration-300 ease-out ${
            open ? "pointer-events-auto translate-y-0 scale-100" : "translate-y-4 scale-95"
          }`}
        >
          <button
            type="button"
            onClick={onClose}
            tabIndex={open ? 0 : -1}
            aria-label="Close"
            className="absolute -right-2 -top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white text-stone-700 ring-1 ring-stone-200 transition hover:rotate-90 hover:bg-stone-50"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <div className="flex flex-col gap-3">{children}</div>
        </div>
      </div>
    </>
  );
}
