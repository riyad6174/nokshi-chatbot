// What the assistant is doing while a tool runs, shown so a pause reads as work, not a hang.
const LABELS: Record<string, string> = {
  search_products: "Searching products…",
  get_product_details: "Checking the details…",
  get_recommendations: "Finding good matches…",
  compare_products: "Comparing…",
  search_knowledge: "Looking that up…",
  get_cart: "Checking your cart…",
  add_to_cart: "Adding to your cart…",
  update_cart_item: "Updating your cart…",
  remove_cart_item: "Updating your cart…",
  propose_order: "Preparing your order…",
  confirm_order: "Placing your order…",
  prepare_checkout: "Preparing checkout…",
  go_to_checkout: "Opening checkout…",
  open_product_page: "Opening the product…",
  get_order_status: "Checking your order…",
  request_human: "Calling a team member…",
};

/** A short status for a tool, or null for quiet ones (saving details in the background). */
export function toolStatusLabel(name: string | null | undefined): string | null {
  return name ? LABELS[name] ?? null : null;
}
