import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin";
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
    <main className="flex min-h-screen items-center justify-center bg-stone-950 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <p className="font-serif text-2xl font-semibold text-white">Nokshi Bazaar</p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-400">Admin console</p>
        </div>

        <form
          action={loginAction}
          className="mt-6 rounded-2xl border border-stone-800 bg-stone-900 p-6 shadow-2xl"
        >
          <h1 className="text-lg font-semibold text-white">Sign in</h1>
          <p className="mt-1 text-[11.5px] text-stone-400">
            Manage the catalog, knowledge, conversations, and checkout settings.
          </p>

          {errorMessage ? (
            <p className="mt-4 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-[11.5px] text-red-300">
              {errorMessage}
            </p>
          ) : null}

          <label htmlFor="admin-email" className="mt-4 block text-[11.5px] font-medium text-stone-300">
            Email
          </label>
          <input
            id="admin-email"
            name="email"
            type="email"
            autoComplete="username"
            required
            defaultValue={process.env.NODE_ENV !== "production" ? process.env.ADMIN_EMAIL : undefined}
            className="mt-1 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-[13px] text-white placeholder:text-stone-600 focus:border-teal focus:outline-none"
            placeholder="you@store.example"
          />

          <label htmlFor="admin-password" className="mt-3 block text-[11.5px] font-medium text-stone-300">
            Password
          </label>
          <input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-[13px] text-white placeholder:text-stone-600 focus:border-teal focus:outline-none"
            placeholder="••••••••"
          />

          <button
            type="submit"
            className="mt-5 w-full rounded-lg bg-teal px-4 py-2.5 text-[12.5px] font-semibold text-white transition hover:brightness-110"
          >
            Sign in
          </button>

          {showDemoHint ? (
            <p className="mt-4 rounded-lg bg-stone-950 px-3 py-2 text-[10.5px] leading-relaxed text-stone-500">
              Seeded demo login: <span className="text-stone-300">{process.env.ADMIN_EMAIL || "admin@example.com"}</span> /{" "}
              <span className="text-stone-300">{process.env.ADMIN_PASSWORD || "admin12345"}</span>
            </p>
          ) : null}
        </form>

        <div className="mt-5 text-center">
          <Link href="/" className="text-[11.5px] text-stone-400 underline-offset-2 hover:text-stone-200 hover:underline">
            Back to the storefront
          </Link>
        </div>
      </div>
    </main>
  );
}
