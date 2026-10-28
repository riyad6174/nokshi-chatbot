import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { isObjectId } from "@/lib/db/ids";
import { seal, unseal } from "@/lib/auth/tokens";
import { verifyPassword } from "@/lib/auth/password";

export const ADMIN_COOKIE = "nb_admin";
const ADMIN_TTL_MS = 1000 * 60 * 60 * 12;

export function createAdminToken(userId: string): string {
  return seal({ sub: userId, exp: Date.now() + ADMIN_TTL_MS });
}

export const adminCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: Math.floor(ADMIN_TTL_MS / 1000),
};

export async function verifyAdminCredentials(email: string, password: string) {
  const user = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return user;
}

export const getAdminUser = cache(async () => {
  const cookieStore = await cookies();
  const payload = unseal<{ sub?: string }>(cookieStore.get(ADMIN_COOKIE)?.value);
  if (!isObjectId(payload?.sub)) return null;
  return prisma.adminUser.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true, createdAt: true },
  });
});

export async function requireAdmin() {
  const user = await getAdminUser();
  if (!user) redirect("/admin/login");
  return user;
}
