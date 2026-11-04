import type { MessageAttachment } from "@prisma/client";
import type { OrchestratorEvent } from "@/modules/ai/orchestrator";
import { runLiveAssistant, type AssistantHistoryMessage } from "@/modules/ai/orchestrator";
import { runDemoAssistant } from "@/modules/ai/demo-assistant";
import { resolveAiConfig } from "@/modules/ai/config";
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
  return runDemoAssistant({
    session: input.session,
    cart: input.cart,
    userText: input.userText,
  });
}
