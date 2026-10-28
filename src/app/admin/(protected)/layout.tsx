import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { AdminNav } from "@/components/dashboard/AdminNav";
import { logoutAction } from "@/app/admin/auth-actions";
import { countConversationsNeedingAttention } from "@/modules/conversations/conversation.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const store = await getPrimaryStore();
  const waiting = store ? await countConversationsNeedingAttention(store.id) : 0;

  return (
    <div className="min-h-screen bg-stone-100">
      <header className="bg-stone-950 text-white">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="font-serif text-lg font-semibold">
              Nokshi Admin
            </Link>
            <span className="hidden rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-stone-300 sm:inline">
              MVP
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11.5px] text-stone-300">
            <Link href="/" target="_blank" className="transition hover:text-white">
              View store
            </Link>
            <span className="hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="hidden sm:inline">{user.email}</span>
            <form action={logoutAction}>
              <button type="submit" className="rounded-md bg-white/10 px-2.5 py-1.5 font-medium text-white transition hover:bg-white/20">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-6 sm:px-8 md:grid-cols-[170px_1fr]">
        <aside className="md:pt-1">
          <AdminNav badges={{ "/admin/inbox": waiting }} />
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
