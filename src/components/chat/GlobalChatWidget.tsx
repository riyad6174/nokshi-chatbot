"use client";

import { usePathname } from "next/navigation";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { useProductContext } from "@/components/chat/ChatProductContext";

/** The storefront assistant on every customer-facing page; one instance, kept across navigation. */
export function GlobalChatWidget() {
  const pathname = usePathname();
  const productId = useProductContext();
  if (pathname?.startsWith("/admin")) return null;
  return <ChatWidget productId={productId} />;
}
