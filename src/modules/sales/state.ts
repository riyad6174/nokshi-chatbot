import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";

// What the assistant has already suggested during this visit, and the customer's wishes about it,
// stored on the chat session (ChatSession.engagement). Shared by the AI tools and the proactive
// engagement engine so neither repeats a suggestion, exceeds the store's limits, or ignores "stop".

export type SuggestionRecord = {
  id: string;
  trigger: string;
  anchorProductId: string | null;
  productIds: string[];
  at: string;
  dismissed?: boolean;
  clicked?: boolean;
};

export type EngagementState = {
  /** The customer asked for no more suggestions (also mirrored on their profile). */
  optOut: boolean;
  proactiveCount: number;
  lastProactiveAt: string | null;
  /** trigger:anchor keys already used for a proactive message. */
  shownKeys: string[];
  /** Products suggested this visit (proactively or by the AI), for de-duplication and attribution. */
  suggestedProductIds: string[];
  dismissedProductIds: string[];
  /** Add-on suggestions the AI made on its own this visit. */
  addOnCount: number;
  checkoutStartedAt: string | null;
  suggestions: SuggestionRecord[];
};

export const EMPTY_STATE: EngagementState = {
  optOut: false,
  proactiveCount: 0,
  lastProactiveAt: null,
  shownKeys: [],
  suggestedProductIds: [],
  dismissedProductIds: [],
  addOnCount: 0,
  checkoutStartedAt: null,
  suggestions: [],
};

const strings = (value: unknown, max: number): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").slice(-max) : [];

export function parseEngagementState(value: string | null | undefined): EngagementState {
  if (!value) return structuredClone(EMPTY_STATE);
  try {
    const raw = JSON.parse(value) as Record<string, unknown>;
    return {
      optOut: raw.optOut === true,
      proactiveCount: Number.isInteger(raw.proactiveCount) ? Number(raw.proactiveCount) : 0,
      lastProactiveAt: typeof raw.lastProactiveAt === "string" ? raw.lastProactiveAt : null,
      shownKeys: strings(raw.shownKeys, 50),
      suggestedProductIds: strings(raw.suggestedProductIds, 60),
      dismissedProductIds: strings(raw.dismissedProductIds, 60),
      addOnCount: Number.isInteger(raw.addOnCount) ? Number(raw.addOnCount) : 0,
      checkoutStartedAt: typeof raw.checkoutStartedAt === "string" ? raw.checkoutStartedAt : null,
      suggestions: Array.isArray(raw.suggestions) ? (raw.suggestions as SuggestionRecord[]).slice(-15) : [],
    };
  } catch {
    return structuredClone(EMPTY_STATE);
  }
}

export async function getEngagementState(sessionId: string): Promise<EngagementState> {
  const session = await prisma.chatSession.findUnique({ where: { id: sessionId }, select: { engagement: true } });
  return parseEngagementState(session?.engagement);
}

/** Read-modify-write of the session's state. Last write wins, which is fine for one visitor's tab(s). */
export async function updateEngagementState(
  sessionId: string,
  mutate: (state: EngagementState) => void,
): Promise<EngagementState> {
  const state = await getEngagementState(sessionId);
  mutate(state);
  state.shownKeys = state.shownKeys.slice(-50);
  state.suggestedProductIds = [...new Set(state.suggestedProductIds)].slice(-60);
  state.dismissedProductIds = [...new Set(state.dismissedProductIds)].slice(-60);
  state.suggestions = state.suggestions.slice(-15);
  await prisma.chatSession.update({ where: { id: sessionId }, data: { engagement: JSON.stringify(state) } });
  return state;
}

/** Records the customer's choice about suggestions on the session and on their profile. */
export async function setSuggestionOptOut(input: { storeId: string; sessionId: string; visitorId: string; optOut: boolean }) {
  await updateEngagementState(input.sessionId, (state) => {
    state.optOut = input.optOut;
  });
  try {
    await prisma.customerProfile.updateMany({
      where: { storeId: input.storeId, visitorIds: { has: input.visitorId } },
      data: { proactiveOptOut: input.optOut },
    });
  } catch (error) {
    logger.warn("sales.opt_out_profile_failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

/** Whether suggestions are off for this visitor: this visit, or remembered from an earlier one. */
export async function isOptedOut(input: { storeId: string; visitorId: string; state: EngagementState }): Promise<boolean> {
  if (input.state.optOut) return true;
  const profile = await prisma.customerProfile.findFirst({
    where: { storeId: input.storeId, visitorIds: { has: input.visitorId } },
    select: { proactiveOptOut: true },
  });
  return profile?.proactiveOptOut === true;
}
