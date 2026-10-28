"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import { orderStatusFormSchema } from "@/lib/validation/schemas";
import { OrderError, updateOrderStatus } from "@/modules/orders/order.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export async function updateOrderStatusAction(formData: FormData) {
  const admin = await requireAdmin();
  const store = await getPrimaryStore();
  if (!store) redirect("/admin?error=store");

  const parsed = orderStatusFormSchema.safeParse({
    orderId: formData.get("orderId"),
    status: formData.get("status"),
    note: formData.get("note") ?? "",
    trackingNumber: formData.get("trackingNumber") ?? undefined,
  });
  const orderId = String(formData.get("orderId") ?? "");
  const path = `/admin/orders/${encodeURIComponent(orderId)}`;
  if (!parsed.success) redirect(`${path}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the fields.")}`);

  try {
    await updateOrderStatus({ storeId: store.id, ...parsed.data, by: admin.name || admin.email });
  } catch (error) {
    const message = error instanceof OrderError ? error.message : "The order could not be updated.";
    redirect(`${path}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/admin/orders");
  revalidatePath(path);
  redirect(`${path}?saved=1`);
}
