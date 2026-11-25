"use client";

import { ChatPartView } from "@/components/chat/ChatPartView";
import { AttachmentView } from "@/components/chat/ChatParts";
import { formatDateTime, formatMessageTime } from "@/lib/dates";
import type { ConversationObservability, ObsMessage, ObsRequest, TokenTotals } from "@/modules/analytics/conversation-observability";
import type { ChatMessage } from "@/types/chat";
import { formatCost, formatTokens } from "./format";

// The conversation as the customer saw it (real product, cart and order cards), for the admin
// inbox: the customer on the left, the AI on the right, a divider per session (a visit, or a voice
// call) and, when token usage is shown, what every AI reply cost in tokens.

export type TimelineSession = {
  index: number;
  kind: "visit" | "voice_call";
  start: string;
  end: string;
  durationMs: number;
  messageIds: string[];
};

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** "3 requests · 17,420 tokens (in 15,912 · cached 4,032 · out 220 …) · $0.0123". */
function TotalsLine({ totals, className = "" }: { totals: TokenTotals; className?: string }) {
  const parts = [
    `in ${formatTokens(totals.inputText)}`,
    totals.inputAudio ? `audio in ${formatTokens(totals.inputAudio)}` : "",
    totals.cached ? `cached ${formatTokens(totals.cached)}` : "",
    `out ${formatTokens(totals.output)}`,
    totals.outputAudio ? `audio out ${formatTokens(totals.outputAudio)}` : "",
    totals.thinking ? `thinking ${formatTokens(totals.thinking)}` : "",
  ].filter(Boolean);
  return (
    <span className={className}>
      {totals.requests} request{totals.requests === 1 ? "" : "s"} · <strong className="font-semibold">{formatTokens(totals.total)} tokens</strong> ({parts.join(" · ")}) ·{" "}
      <strong className="font-semibold">{formatCost(totals.costMicros)}</strong>
      {totals.unpriced ? <span className="text-amber-700"> · {totals.unpriced} unpriced</span> : null}
    </span>
  );
}

function RequestTable({ requests }: { requests: ObsRequest[] }) {
  return (
    <div className="mt-1.5 overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-[10.5px] tabular-nums">
        <thead>
          <tr className="text-stone-500">
            {["Time", "Model", "Kind", "Input", "Audio in", "Cached", "Output", "Audio out", "Thinking", "Total", "Cost"].map((label) => (
              <th key={label} className="py-1 pr-2 font-medium" scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id} className="border-t border-stone-200">
              <td className="py-1 pr-2 whitespace-nowrap">
                {new Date(request.at).toLocaleTimeString("en-US", { timeZone: "Asia/Dhaka", hour: "numeric", minute: "2-digit", second: "2-digit" })}
                {request.attribution === "estimated" ? (
                  <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-semibold uppercase text-amber-800" title="Recorded before requests were linked to messages: matched to this reply by time.">
                    est.
                  </span>
                ) : null}
              </td>
              <td className="py-1 pr-2 font-mono">{request.model}</td>
              <td className="py-1 pr-2">{request.channel === "voice" ? "voice" : "text"} · {request.kind.replaceAll("_", " ")}</td>
              <td className="py-1 pr-2">{formatTokens(request.tokens.inputText)}</td>
              <td className="py-1 pr-2">{formatTokens(request.tokens.inputAudio)}</td>
              <td className="py-1 pr-2">{formatTokens(request.tokens.cached)}</td>
              <td className="py-1 pr-2">{formatTokens(request.tokens.output)}</td>
              <td className="py-1 pr-2">{formatTokens(request.tokens.outputAudio)}</td>
              <td className="py-1 pr-2">{formatTokens(request.tokens.thinking)}</td>
              <td className="py-1 pr-2 font-semibold">{formatTokens(request.tokens.total)}</td>
              <td className="py-1 pr-2">{request.costMicros == null ? "unpriced" : formatCost(request.costMicros)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MessageUsage({ usage }: { usage: ObsMessage }) {
  const timing = [
    usage.firstTokenMs != null ? `first words ${(usage.firstTokenMs / 1000).toFixed(1)} s` : "",
    usage.latencyMs != null ? `full reply ${(usage.latencyMs / 1000).toFixed(1)} s` : "",
    usage.tools.length ? `tools: ${usage.tools.join(", ")}` : "",
  ].filter(Boolean);
  return (
    <details className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[10.5px] text-stone-600">
      <summary className="cursor-pointer select-none">
        <TotalsLine totals={usage.totals} />
        {usage.requests.some((request) => request.attribution === "estimated") ? <span className="text-amber-700"> · estimated</span> : null}
      </summary>
      {timing.length ? <p className="mt-1 text-stone-500">{timing.join(" · ")}</p> : null}
      <RequestTable requests={usage.requests} />
    </details>
  );
}

export function ConversationTimeline({
  messages,
  accent,
  customer,
  sessions,
  observability,
}: {
  messages: ChatMessage[];
  accent: string;
  customer: { name: string | null; visitorId: string; phone?: string | null };
  sessions: TimelineSession[];
  /** Present only when the admin turned token usage on. */
  observability: ConversationObservability | null;
}) {
  const customerLabel = customer.name ? customer.name : `Visitor ${customer.visitorId.slice(-6)}`;
  const sessionStart = new Map(sessions.map((session) => [session.messageIds[0], session]));
  const voiceMessages = new Set(sessions.filter((session) => session.kind === "voice_call").flatMap((session) => session.messageIds));

  // Only the newest order summary could be confirmed, and only until an order was placed after it.
  const lastSummaryAt = messages.findLastIndex((message) => message.parts.some((part) => part.type === "order_confirmation"));
  const placedAfter =
    lastSummaryAt !== -1 &&
    messages.slice(lastSummaryAt + 1).some((message) => message.role === "event" && message.parts.some((part) => part.type === "order_status"));
  const summaryState = (index: number): "open" | "placed" | "stale" => (index !== lastSummaryAt ? "stale" : placedAfter ? "placed" : "open");

  return (
    <div className="space-y-3">
      {messages.map((message, index) => {
        const session = sessionStart.get(message.id);
        const sessionUsage = session && observability ? observability.sessions[session.index] : null;
        const divider = session ? (
          <div key={`session-${session.index}`} className="flex items-center gap-3 pt-2" role="separator" aria-label={`Session ${session.index + 1}`}>
            <span className="h-px flex-1 bg-stone-300" />
            <span className="flex flex-col items-center text-center">
              <span className="rounded-full bg-stone-200 px-3 py-1 text-[10.5px] font-semibold text-stone-700">
                {session.kind === "voice_call" ? "🎙 Voice call" : `Session ${session.index + 1}`} · {formatDateTime(session.start)}
                {session.kind === "voice_call" ? ` · ${duration(session.durationMs)}` : ""} · {session.messageIds.length} message{session.messageIds.length === 1 ? "" : "s"}
              </span>
              {sessionUsage ? (
                <span className="mt-1 text-[10px] text-stone-500">
                  <TotalsLine totals={sessionUsage.totals} />
                  {sessionUsage.unattributed.length ? ` · ${sessionUsage.unattributed.length} not tied to a message` : ""}
                </span>
              ) : null}
            </span>
            <span className="h-px flex-1 bg-stone-300" />
          </div>
        ) : null;

        if (message.role === "event") {
          const text = message.parts.find((part) => part.type === "text");
          return (
            <div key={message.id} id={`msg-${message.id}`} className="space-y-2">
              {divider}
              <div className="flex justify-center">
                <span className="rounded-full bg-stone-100 px-3 py-1 text-[10.5px] text-stone-600">
                  {text && text.type === "text" ? text.text : "Update"} · {formatMessageTime(message.createdAt)}
                </span>
              </div>
              {message.parts
                .filter((part) => part.type === "order_status")
                .map((part, partIndex) => (
                  <div key={partIndex} className="mx-auto max-w-md" inert>
                    <ChatPartView part={part} accent={accent} />
                  </div>
                ))}
            </div>
          );
        }

        const fromCustomer = message.role === "user";
        const agent = message.role === "agent";
        const voice = voiceMessages.has(message.id);
        const text = message.parts
          .filter((part) => part.type === "text")
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("\n")
          .trim();
        const cards = message.parts.filter((part) => part.type !== "text");
        const usage = observability?.byMessage[message.id];
        const badge = fromCustomer ? (
          <>
            <span className="font-semibold text-stone-800">Customer · {customerLabel}</span>
            {!customer.name ? null : <span className="text-stone-400"> · {customer.visitorId.slice(-6)}</span>}
            {customer.phone ? <span className="text-stone-400"> · {customer.phone}</span> : null}
          </>
        ) : agent ? (
          <span className="font-semibold text-stone-800">Agent · {message.senderName || "Store team"}</span>
        ) : (
          <span className="font-semibold" style={{ color: accent }}>
            AI assistant
          </span>
        );

        return (
          <div key={message.id} id={`msg-${message.id}`} className="space-y-1">
            {divider}
            <div className={`flex ${fromCustomer ? "justify-start" : "justify-end"}`}>
              <div className={`flex max-w-[85%] flex-col gap-1 ${fromCustomer ? "items-start" : "items-end"}`}>
                <p className="text-[10.5px] text-stone-500">
                  {badge}
                  {voice ? <span title="Said on a voice call"> · 🎙</span> : null} ·{" "}
                  <time dateTime={new Date(message.createdAt).toISOString()} title={formatDateTime(message.createdAt)}>
                    {formatMessageTime(message.createdAt)}
                  </time>
                </p>
                {message.attachments?.map((attachment) => (
                  <div key={attachment.uploadId} className="rounded-2xl bg-stone-100 p-2">
                    <AttachmentView attachment={attachment} />
                  </div>
                ))}
                {text ? (
                  <div
                    className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                      fromCustomer ? "rounded-tl-md bg-stone-100 text-stone-900" : agent ? "rounded-tr-md bg-stone-800 text-white" : "rounded-tr-md text-white"
                    }`}
                    style={!fromCustomer && !agent ? { backgroundColor: accent } : undefined}
                  >
                    {text}
                  </div>
                ) : null}
                {cards.length ? (
                  // inert: the cards look exactly as the customer saw them but can't be clicked here.
                  <div className="w-full min-w-[280px] max-w-[560px] space-y-2" inert>
                    {cards.map((part, partIndex) => (
                      <ChatPartView key={partIndex} part={part} accent={accent} confirmationState={summaryState(index)} />
                    ))}
                  </div>
                ) : null}
                {usage ? <MessageUsage usage={usage} /> : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
