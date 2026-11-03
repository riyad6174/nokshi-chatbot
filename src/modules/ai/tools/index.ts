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
import type { ToolContext, ToolDefinition, ToolExecutionResult } from "@/modules/ai/tools/types";

const tools: ToolDefinition[] = [
  searchProductsTool,
  getProductDetailsTool,
  getRecommendationsTool,
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

export function getProviderTools(): ProviderTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
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
