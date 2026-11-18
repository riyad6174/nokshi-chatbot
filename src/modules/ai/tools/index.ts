import { ZodError } from "zod";
import { logger } from "@/lib/logging/logger";
import type { ProviderTool } from "@/modules/ai/provider";
import { addToCartTool } from "@/modules/ai/tools/add-to-cart";
import { getCartTool } from "@/modules/ai/tools/get-cart";
import { getProductDetailsTool } from "@/modules/ai/tools/get-product-details";
import { prepareCheckoutTool } from "@/modules/ai/tools/prepare-checkout";
import { removeCartItemTool } from "@/modules/ai/tools/remove-cart-item";
import { searchKnowledgeTool } from "@/modules/ai/tools/search-knowledge";
import { searchProductsTool } from "@/modules/ai/tools/search-products";
import { updateCartItemTool } from "@/modules/ai/tools/update-cart-item";
import { saveCustomerDetailsTool } from "@/modules/ai/tools/save-customer-details";
import { getOrderStatusTool } from "@/modules/ai/tools/get-order-status";
import { requestHumanTool } from "@/modules/ai/tools/request-human";
import { proposeOrderTool } from "@/modules/ai/tools/propose-order";
import { confirmOrderTool } from "@/modules/ai/tools/confirm-order";
import { getRecommendationsTool } from "@/modules/ai/tools/get-recommendations";
import { saveCustomerProfileTool } from "@/modules/ai/tools/save-customer-profile";
import { collectContactDetailsTool } from "@/modules/ai/tools/collect-contact-details";
import { goToCheckoutTool, openProductPageTool } from "@/modules/ai/tools/navigation";
import { compareProductsTool } from "@/modules/ai/tools/compare-products";
import type { ToolContext, ToolDefinition, ToolExecutionResult } from "@/modules/ai/tools/types";

const tools: ToolDefinition[] = [
  searchProductsTool,
  getProductDetailsTool,
  getRecommendationsTool,
  compareProductsTool,
  searchKnowledgeTool,
  getCartTool,
  addToCartTool,
  updateCartItemTool,
  removeCartItemTool,
  prepareCheckoutTool,
  saveCustomerDetailsTool,
  proposeOrderTool,
  confirmOrderTool,
  saveCustomerProfileTool,
  collectContactDetailsTool,
  openProductPageTool,
  goToCheckoutTool,
  getOrderStatusTool,
  requestHumanTool,
];

const byName = new Map(tools.map((tool) => [tool.name, tool]));

// Admin settings can turn a capability off. Tools that don't belong to a toggleable feature (orders,
// profile, handoff, navigation) stay available so existing behaviour is unchanged.
const TOOL_FEATURES: Record<string, string> = {
  search_products: "product_cards",
  get_product_details: "product_cards",
  get_recommendations: "product_cards",
  compare_products: "product_cards",
  open_product_page: "product_cards",
  get_cart: "cart_tools",
  add_to_cart: "cart_tools",
  update_cart_item: "cart_tools",
  remove_cart_item: "cart_tools",
  prepare_checkout: "cart_tools",
  search_knowledge: "knowledge_search",
};

function enabledToolFeatures(raw: string | string[] | null | undefined): Set<string> | null {
  if (Array.isArray(raw)) return raw.length > 0 ? new Set(raw) : null;
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length > 0 ? new Set(parsed.map(String)) : null;
  } catch {
    return null;
  }
}

function shortenDescription(description: string): string {
  const text = description.replace(/\s+/g, " ").trim();
  if (text.length <= 420) return text;
  const cut = text.slice(0, 420);
  const sentence = cut.lastIndexOf(". ");
  return `${(sentence > 180 ? cut.slice(0, sentence + 1) : cut.slice(0, 417)).trim()}…`;
}

export function getProviderTools(enabledFeatures?: string | string[] | null): ProviderTool[] {
  const enabled = enabledToolFeatures(enabledFeatures);
  const allowed = enabled
    ? tools.filter((tool) => {
        const feature = TOOL_FEATURES[tool.name];
        return !feature || enabled.has(feature);
      })
    : tools;
  return allowed.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: shortenDescription(tool.description),
      parameters: tool.parameters,
    },
  }));
}

export async function executeTool(
  ctx: ToolContext,
  name: string,
  rawArguments: string,
): Promise<ToolExecutionResult> {
  const tool = byName.get(name);
  if (!tool) {
    return { ok: false, content: { ok: false, error: { code: "unknown_tool", message: "Unknown tool." } } };
  }

  let parsedArguments: unknown = {};
  if (rawArguments.trim()) {
    try {
      parsedArguments = JSON.parse(rawArguments);
    } catch {
      return {
        ok: false,
        content: { ok: false, error: { code: "invalid_arguments", message: "Tool arguments were not valid JSON." } },
      };
    }
  }

  try {
    const validation = tool.schema.safeParse(parsedArguments);
    if (!validation.success) {
      return {
        ok: false,
        content: {
          ok: false,
          error: {
            code: "invalid_arguments",
            message: "Tool arguments failed validation.",
            details: validation.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
          },
        },
      };
    }
    return await tool.execute(ctx, validation.data);
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        ok: false,
        content: { ok: false, error: { code: "invalid_arguments", message: "Tool arguments failed validation." } },
      };
    }
    logger.error("ai.tool_failed", { tool: name, error: error instanceof Error ? error.message : String(error) });
    return {
      ok: false,
      content: { ok: false, error: { code: "tool_failed", message: "The tool could not complete the request." } },
    };
  }
}

export const toolNames = tools.map((tool) => tool.name);

/** Whether every call in a model round only reads, so they can run at the same time. */
export function canRunInParallel(names: string[]): boolean {
  return names.length > 1 && names.every((name) => byName.get(name)?.parallelSafe === true);
}
