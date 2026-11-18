"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/** How close to the bottom (px) still counts as "reading the latest messages". */
const NEAR_BOTTOM_PX = 120;

/**
 * The message list of an inbox conversation. Opens at the newest message (long chats used to open
 * at the first one, so the latest messages seemed missing) and follows new ones as the page
 * auto-refreshes, unless the agent has scrolled up to read older messages.
 */
export function ConversationScroll({
  messageCount,
  className = "",
  children,
}: {
  messageCount: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onScroll = () => {
      followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, []);

  // Before paint, so the list never flashes at the top first.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && followRef.current) element.scrollTop = element.scrollHeight;
  }, [messageCount]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
