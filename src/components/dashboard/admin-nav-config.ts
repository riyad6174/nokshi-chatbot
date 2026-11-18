import type { IconType } from "react-icons";
import {
  LuBookOpen,
  LuBot,
  LuChartLine,
  LuCpu,
  LuGauge,
  LuInbox,
  LuLayoutDashboard,
  LuMegaphone,
  LuPackage,
  LuSettings,
  LuShoppingBag,
  LuSparkles,
  LuStore,
  LuTrendingUp,
  LuUsers,
} from "react-icons/lu";

export type AdminNavLink = { href: string; label: string; icon: IconType; exact?: boolean };
export type AdminNavGroup = { id: string; label: string; icon: IconType; links: AdminNavLink[] };

// Grouped by job. Routes are unchanged; labels are what the e2e tests click, so keep them stable.
export const ADMIN_NAV: AdminNavGroup[] = [
  {
    id: "home",
    label: "Home",
    icon: LuLayoutDashboard,
    links: [
      { href: "/admin", label: "Overview", icon: LuLayoutDashboard, exact: true },
      { href: "/admin/inbox", label: "Inbox", icon: LuInbox },
    ],
  },
  {
    id: "commerce",
    label: "Commerce",
    icon: LuStore,
    links: [
      { href: "/admin/orders", label: "Orders", icon: LuShoppingBag },
      { href: "/admin/customers", label: "Customers", icon: LuUsers },
      { href: "/admin/products", label: "Products", icon: LuPackage },
    ],
  },
  {
    id: "ai",
    label: "AI assistant",
    icon: LuSparkles,
    links: [
      { href: "/admin/chatbot", label: "Configure chatbot", icon: LuBot },
      { href: "/admin/knowledge", label: "Knowledge", icon: LuBookOpen },
      { href: "/admin/sales", label: "AI Sales & Engagement", icon: LuTrendingUp },
      { href: "/admin/ai-usage", label: "AI usage", icon: LuGauge },
      { href: "/admin/ai", label: "AI model", icon: LuCpu },
    ],
  },
  {
    id: "growth",
    label: "Growth",
    icon: LuChartLine,
    links: [
      { href: "/admin/marketing", label: "Marketing", icon: LuMegaphone },
      { href: "/admin/analytics", label: "Analytics", icon: LuChartLine },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: LuSettings,
    links: [{ href: "/admin/settings", label: "Store settings", icon: LuSettings }],
  },
];

export function isNavLinkActive(pathname: string, link: AdminNavLink): boolean {
  if (link.exact) return pathname === link.href;
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
}

/** The group and page for the current route, for the top bar's breadcrumb. */
export function findNavLocation(pathname: string): { group: AdminNavGroup; link: AdminNavLink } | null {
  for (const group of ADMIN_NAV) {
    for (const link of group.links) if (isNavLinkActive(pathname, link)) return { group, link };
  }
  // Legacy route that redirects into the Inbox.
  if (pathname.startsWith("/admin/conversations")) {
    const group = ADMIN_NAV[0]!;
    return { group, link: group.links[1]! };
  }
  return null;
}
