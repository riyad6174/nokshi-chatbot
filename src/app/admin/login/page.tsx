import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin";
import { LuArrowRight, LuCircleAlert, LuLock, LuMail, LuSparkles } from "react-icons/lu";
import { loginAction } from "@/app/admin/auth-actions";

export const metadata: Metadata = {
  title: "Admin sign in — Nokshi Bazaar",
  robots: { index: false, follow: false },
};

const MESSAGES: Record<string, string> = {
  invalid: "That email and password combination did not work.",
  rate: "Too many sign-in attempts. Please wait a few minutes.",
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const existing = await getAdminUser();
  if (existing) redirect("/admin");

  const { error } = await searchParams;
  const errorMessage = error ? MESSAGES[error] || "Sign in failed." : null;
  const showDemoHint =
    process.env.NODE_ENV !== "production" &&
    (process.env.ADMIN_EMAIL || "admin@example.com") &&
    (process.env.ADMIN_PASSWORD || "admin12345");

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-stone-950 px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="admin-blob absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-[#d8b878]/[0.14] blur-3xl" />
        <div className="admin-blob absolute -bottom-48 -right-32 h-[520px] w-[520px] rounded-full bg-[#b18c4b]/[0.12] blur-3xl [animation-delay:-9s]" />
        <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      </div>

      <div className="relative w-full max-w-sm animate-fade-up">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f3e1b8] via-[#d8b878] to-[#b18c4b] text-[#191307] shadow-[0_20px_44px_-20px_rgba(216,184,120,0.85)] ring-1 ring-inset ring-white/40">
            <LuSparkles className="h-6 w-6" aria-hidden />
          </span>
          <p className="mt-4 text-2xl font-semibold tracking-tight text-white">Nokshi Bazaar</p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8a8478]">Admin console</p>
        </div>

        <form
          action={loginAction}
          className="mt-7 rounded-3xl border border-white/10 bg-white/[0.06] p-7 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] backdrop-blur-2xl"
        >
          <h1 className="text-lg font-semibold text-white">Sign in</h1>
          <p className="mt-1 text-[12px] text-stone-400">
            Manage the catalog, knowledge, conversations, and checkout settings.
          </p>

          {errorMessage ? (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[11.5px] text-rose-200">
              <LuCircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              {errorMessage}
            </p>
          ) : null}

          <label htmlFor="admin-email" className="mt-5 block text-[11.5px] font-medium text-stone-300">
            Email
          </label>
          <div className="relative mt-1.5">
            <LuMail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" aria-hidden />
            <input
              id="admin-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              defaultValue={process.env.NODE_ENV !== "production" ? process.env.ADMIN_EMAIL : undefined}
              className="w-full rounded-xl border border-white/10 bg-white/[0.05] py-2.5 pl-9 pr-3 text-[13px] text-white placeholder:text-stone-500 transition focus:border-[#d8b878]/60 focus:bg-white/[0.08] focus:outline-none focus:ring-4 focus:ring-[#d8b878]/15"
              placeholder="you@store.example"
            />
          </div>

          <label htmlFor="admin-password" className="mt-4 block text-[11.5px] font-medium text-stone-300">
            Password
          </label>
          <div className="relative mt-1.5">
            <LuLock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" aria-hidden />
            <input
              id="admin-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-xl border border-white/10 bg-white/[0.05] py-2.5 pl-9 pr-3 text-[13px] text-white placeholder:text-stone-500 transition focus:border-[#d8b878]/60 focus:bg-white/[0.08] focus:outline-none focus:ring-4 focus:ring-[#d8b878]/15"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            className="group mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#f3e1b8] via-[#d8b878] to-[#b18c4b] px-4 py-2.5 text-[13px] font-semibold text-[#191307] shadow-[0_18px_40px_-18px_rgba(216,184,120,0.8)] transition hover:-translate-y-px hover:brightness-105"
          >
            Sign in
            <LuArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
          </button>

          {showDemoHint ? (
            <p className="mt-5 rounded-xl border border-white/5 bg-black/20 px-3 py-2.5 text-[10.5px] leading-relaxed text-stone-400">
              Seeded demo login: <span className="text-stone-300">{process.env.ADMIN_EMAIL || "admin@example.com"}</span> /{" "}
              <span className="text-stone-300">{process.env.ADMIN_PASSWORD || "admin12345"}</span>
            </p>
          ) : null}
        </form>

        <div className="mt-6 text-center">
          <Link href="/" className="text-[11.5px] text-stone-400 underline-offset-2 transition hover:text-stone-200 hover:underline">
            Back to the storefront
          </Link>
        </div>
      </div>
    </main>
  );
}
