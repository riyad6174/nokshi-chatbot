import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Deployment self-check: GET /api/health. Reports which pieces are configured and reachable,
// never their values. Deliberately doesn't import the env module, because that throws when
// configuration is wrong, which is exactly what this endpoint diagnoses.

type Check = { ok: boolean; detail: string };

function present(name: string): boolean {
  return (process.env[name] ?? "").trim().length > 0;
}

export async function GET() {
  const checks: Record<string, Check> = {};

  const secret = process.env.AUTH_SECRET?.trim() ?? "";
  checks.authSecret = {
    ok: secret.length >= 16,
    detail: secret.length >= 16 ? "set" : "missing or shorter than 16 characters: set AUTH_SECRET and redeploy",
  };

  const dbUrl = process.env.DATABASE_URL?.trim() ?? "";
  checks.databaseUrl = {
    ok: /^mongodb(\+srv)?:\/\//.test(dbUrl),
    detail: !dbUrl
      ? "missing: set DATABASE_URL to your Atlas connection string"
      : /^mongodb(\+srv)?:\/\//.test(dbUrl)
        ? "set (MongoDB)"
        : "not a MongoDB URL (did it still point at SQLite?)",
  };

  const appUrl = process.env.APP_BASE_URL?.trim() ?? "";
  checks.appBaseUrl = {
    ok: /^https:\/\//.test(appUrl),
    detail: !appUrl
      ? "missing: set APP_BASE_URL to your https://… Vercel URL (checkout links use it)"
      : /^https:\/\//.test(appUrl)
        ? "set"
        : "should be your public https:// URL",
  };

  checks.widgetKey = {
    ok: present("NEXT_PUBLIC_WIDGET_KEY") || present("WIDGET_PUBLIC_KEY"),
    detail: "NEXT_PUBLIC_WIDGET_KEY should match the store's widget key (seed default: demo-widget-key)",
  };

  if (checks.databaseUrl.ok) {
    try {
      const { prisma } = await import("@/lib/db/prisma");
      const started = Date.now();
      const [stores, admins] = await Promise.all([prisma.store.count(), prisma.adminUser.count()]);
      checks.database = { ok: true, detail: `connected in ${Date.now() - started} ms` };
      checks.seeded = {
        ok: stores > 0 && admins > 0,
        detail:
          stores > 0 && admins > 0
            ? `${stores} store(s), ${admins} admin user(s)`
            : "database is empty: run `npm run db:push` and `npm run db:seed` with DATABASE_URL pointing at Atlas",
      };
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      const message = error instanceof Error ? error.message : "";
      const hint = /outdated Prisma Client|caches dependencies/i.test(message)
        ? "Prisma Client is stale: redeploy without build cache (postinstall now runs prisma generate)"
        : /Server selection timeout|ENOTFOUND|timed out|No available servers/i.test(message)
          ? "can't reach MongoDB: in Atlas → Network Access allow 0.0.0.0/0 (Vercel uses changing IPs), and check the host name"
          : /Authentication failed|bad auth/i.test(message)
            ? "MongoDB rejected the username/password in DATABASE_URL"
            : "query failed; see the function logs in Vercel for details";
      checks.database = { ok: false, detail: `${name}: ${hint}` };
    }
  }

  const ok = Object.values(checks).every((check) => check.ok);
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
