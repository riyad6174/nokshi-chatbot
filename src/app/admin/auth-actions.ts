"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  createAdminToken,
  verifyAdminCredentials,
} from "@/lib/auth/admin";
import { rateLimit } from "@/lib/rate-limit";
import { adminLoginSchema } from "@/lib/validation/schemas";
import { logger } from "@/lib/logging/logger";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  const headerStore = await headers();
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const rate = await rateLimit(`admin-login:${ip}`, 10, 5 * 60_000);
  if (!rate.allowed) redirect("/admin/login?error=rate");

  const parsed = adminLoginSchema.safeParse({ email, password });
  if (!parsed.success) redirect("/admin/login?error=invalid");

  const user = await verifyAdminCredentials(parsed.data.email, parsed.data.password);
  if (!user) {
    logger.warn("admin.login_failed", { emailLength: email.length });
    redirect("/admin/login?error=invalid");
  }

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, createAdminToken(user.id), adminCookieOptions);
  logger.info("admin.login_success", { userId: user.id });
  redirect("/admin");
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE);
  redirect("/admin/login");
}
