import type { MessageAttachment } from "@prisma/client";
import type { OrchestratorEvent } from "@/modules/ai/orchestrator";
import { runLiveAssistant, type AssistantHistoryMessage } from "@/modules/ai/orchestrator";
import { runDemoAssistant } from "@/modules/ai/demo-assistant";
import { resolveAiConfig, resolveAiStatus } from "@/modules/ai/config";
import { logger } from "@/lib/logging/logger";
import type { SessionContext } from "@/modules/conversations/session.service";
import type { TurnChannel } from "@/modules/conversations/turn.service";
import type { StoreWithSettings } from "@/modules/stores/store.service";
import type { CartPayload } from "@/types/chat";

export function isLiveAiEnabled(store: Pick<StoreWithSettings, "settings">): boolean {
  return resolveAiConfig(store.settings) !== null;
}

export function runAssistant(input: {
  session: SessionContext;
  cart: CartPayload;
  history: AssistantHistoryMessage[];
  userText: string;
  channel?: TurnChannel;
  signal?: AbortSignal;
  conversationSummary?: string;
  attachments?: MessageAttachment[];
}): AsyncGenerator<OrchestratorEvent> {
  const config = resolveAiConfig(input.session.store.settings);
  if (config) {
    return runLiveAssistant({
      session: input.session,
      cart: input.cart,
      history: input.history,
      config,
      channel: input.channel ?? "text",
      signal: input.signal,
      conversationSummary: input.conversationSummary,
      attachments: input.attachments,
    });
  }
  warnDemoMode(input.session);
  return runDemoAssistant({
    session: input.session,
    cart: input.cart,
    userText: input.userText,
  });
}

const lastDemoWarning = new Map<string, number>();

/**
 * Replies from the rule-based demo bot look like wrong AI answers, so say so in the logs (once a
 * minute per store): usually no key is saved, or a saved key can't be decrypted after AUTH_SECRET changed.
 */
function warnDemoMode(session: SessionContext) {
  const now = Date.now();
  if (now - (lastDemoWarning.get(session.storeId) ?? 0) < 60_000) return;
  lastDemoWarning.set(session.storeId, now);
  const status = resolveAiStatus(session.store.settings);
  logger.warn("ai.demo_mode_reply", {
    storeId: session.storeId,
    keySource: status.keySource,
    keyUnreadable: status.keyUnreadable,
    model: status.model,
  });
}
