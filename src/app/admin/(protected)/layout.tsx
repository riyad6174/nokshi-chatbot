import { requireAdmin } from "@/lib/auth/admin";
import { AdminShell } from "@/components/dashboard/AdminShell";
import { countConversationsNeedingAttention } from "@/modules/conversations/conversation.service";
import { getAdminPageStore } from "@/modules/stores/admin-store";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Independent lookups, at once (requireAdmin still redirects a logged-out visitor).
  const [user, store] = await Promise.all([requireAdmin(), getAdminPageStore()]);
  // Not awaited: the page renders straight away and the badge fills in when the count arrives.
  const waiting = store ? countConversationsNeedingAttention(store.id).catch(() => 0) : 0;

  return (
    <AdminShell user={{ email: user.email, name: user.name }} storeName={store?.name ?? null} waiting={waiting}>
      {children}
    </AdminShell>
  );
}
