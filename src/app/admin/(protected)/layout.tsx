import { requireAdmin } from "@/lib/auth/admin";
import { AdminShell } from "@/components/dashboard/AdminShell";
import { countConversationsNeedingAttention } from "@/modules/conversations/conversation.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const store = await getPrimaryStore();
  const waiting = store ? await countConversationsNeedingAttention(store.id) : 0;

  return (
    <AdminShell user={{ email: user.email, name: user.name }} storeName={store?.name ?? null} waiting={waiting}>
      {children}
    </AdminShell>
  );
}
