import type { ChatMessage } from "@/types/chat";

// Keeping the chat's message list in step with the server. Messages shown before the server has them
// (the customer's own message, a reply as it streams in) carry temporary ids. When the server copy
// arrives, it takes the temporary one's place and inherits its `localKey`, so the bubble on screen
// stays the same element: no duplicate, no second entrance animation.

/** Temporary ids: an optimistic customer message (`user-…`) or a reply still streaming (`pending-…`). */
export function isTemporaryId(id: string): boolean {
  return id.startsWith("user-") || id.startsWith("pending-");
}

/** The React key of a message: stable across the temporary id -> server id swap. */
export function messageKey(message: ChatMessage): string {
  return message.localKey ?? message.id;
}

/** What a message says, to recognise a temporary message's server copy. */
function signature(message: ChatMessage): string {
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text.trim() : `[${part.type}]`))
    .join(" ")
    .replace(/\s*\(interrupted\)$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const files = (message.attachments ?? []).map((attachment) => attachment.uploadId).join(",");
  return `${message.role === "agent" ? "assistant" : message.role}|${text}|${files}`;
}

const byTime = (left: ChatMessage, right: ChatMessage) => Date.parse(left.createdAt) - Date.parse(right.createdAt);

/**
 * Merges messages from the server into the list on screen.
 *
 * - Known ids are kept once (the server copy wins, keeping the on-screen key).
 * - A temporary message whose server copy arrives is replaced by it in place, unless it's still in
 *   flight (`inFlight`: its reply is streaming; the stream swaps it itself).
 * - `full`: `incoming` is the whole conversation (reopening the chat). It becomes the list, followed by
 *   temporaries still in flight; finished temporaries are dropped (their server copies are in it).
 */
export function mergeMessages(
  current: ChatMessage[],
  incoming: ChatMessage[],
  options: { full?: boolean; inFlight?: ReadonlySet<string> } = {},
): ChatMessage[] {
  const inFlight = options.inFlight ?? new Set<string>();
  if (incoming.length === 0 && !options.full) return current;

  const currentById = new Map(current.map((message) => [message.id, message]));
  // Server copies of temporary messages, matched by what they say (oldest first, each used once).
  const replacement = new Map<string, ChatMessage>();
  const claimed = new Set<string>();
  const unknown = [...incoming].filter((message) => !currentById.has(message.id)).sort(byTime);
  for (const temp of current) {
    if (!isTemporaryId(temp.id)) continue;
    const match = unknown.find((message) => !claimed.has(message.id) && signature(message) === signature(temp));
    if (!match) continue;
    claimed.add(match.id);
    // Still streaming: its stream swaps it in itself, so the server copy is held back (not shown twice).
    if (!inFlight.has(temp.id)) replacement.set(temp.id, { ...match, localKey: temp.localKey ?? temp.id });
  }

  if (options.full) {
    const keyFor = new Map<string, string>();
    for (const message of current) keyFor.set(message.id, messageKey(message));
    for (const [tempId, message] of replacement) keyFor.set(message.id, messageKey(currentById.get(tempId)!));
    const server = [...incoming].sort(byTime).map((message) => {
      const key = keyFor.get(message.id);
      return key && key !== message.id ? { ...message, localKey: key } : message;
    });
    const stillInFlight = current.filter((message) => isTemporaryId(message.id) && inFlight.has(message.id));
    return [...server, ...stillInFlight];
  }

  // Ids already on screen keep the copy on screen (it may hold local previews, e.g. attachments).
  const merged = replacement.size === 0 ? current : current.map((message) => replacement.get(message.id) ?? message);
  const added = unknown.filter((message) => !claimed.has(message.id));
  if (added.length === 0) return merged;
  // New messages go after what's on screen, but before replies still streaming in.
  const firstInFlight = merged.findIndex((message) => isTemporaryId(message.id) && inFlight.has(message.id));
  return firstInFlight === -1 ? [...merged, ...added] : [...merged.slice(0, firstInFlight), ...added, ...merged.slice(firstInFlight)];
}
