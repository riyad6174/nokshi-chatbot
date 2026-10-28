"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/inbox", label: "Inbox" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/chatbot", label: "Configure chatbot" },
  { href: "/admin/knowledge", label: "Knowledge" },
  { href: "/admin/ai", label: "AI model" },
  { href: "/admin/settings", label: "Store settings" },
];

export function AdminNav({ badges = {} }: { badges?: Record<string, number> }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin" className="flex gap-1 overflow-x-auto md:flex-col md:gap-1">
      {LINKS.map((link) => {
        const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
        const badge = badges[link.href] ?? 0;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium transition ${
              active
                ? "bg-stone-900 text-white"
                : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            }`}
          >
            {link.label}
            {badge > 0 ? (
              <span
                className="rounded-full bg-red-500 px-1.5 py-px text-[10px] font-semibold text-white"
                aria-label={`${badge} waiting`}
              >
                {badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
