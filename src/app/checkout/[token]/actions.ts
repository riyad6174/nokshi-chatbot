"use server";

import { redirect } from "next/navigation";
import { logger } from "@/lib/logging/logger";
import { placeOrderFormSchema } from "@/lib/validation/schemas";
import { OrderError, placeOrderFromCheckout } from "@/modules/orders/order.service";

export type PlaceOrderState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Item-level problems (price changed, sold out) to show next to the message. */
  issues?: Array<{ name: string; reason: string }>;
};

export async function placeOrderAction(_previous: PlaceOrderState, formData: FormData): Promise<PlaceOrderState> {
  const token = String(formData.get("token") ?? "");
  const parsed = placeOrderFormSchema.safeParse({
    token,
    customer: {
      name: formData.get("name") ?? "",
      phone: formData.get("phone") ?? "",
      email: formData.get("email") ?? "",
      address: formData.get("address") ?? "",
      city: formData.get("city") ?? "",
      notes: formData.get("notes") ?? "",
    },
    shippingZoneId: formData.get("shippingZoneId") ?? "",
    paymentMethod: formData.get("paymentMethod") ?? "cod",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[issue.path.length - 1] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { error: "Please check the highlighted fields.", fieldErrors };
  }

  try {
    await placeOrderFromCheckout(parsed.data);
  } catch (error) {
    if (error instanceof OrderError) {
      return {
        error: error.message,
        issues: Array.isArray(error.details) ? (error.details as PlaceOrderState["issues"]) : undefined,
      };
    }
    logger.error("order.place_failed", { error: error instanceof Error ? error.message : String(error) });
    return { error: "The order could not be placed. Nothing was charged. Please try again." };
  }

  // The checkout page shows the confirmation once the order exists.
  redirect(`/checkout/${encodeURIComponent(parsed.data.token)}`);
}
