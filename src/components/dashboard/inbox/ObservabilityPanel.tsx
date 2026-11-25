"use client";

import { useMemo, useRef, useState } from "react";
import type { ConversationObservability, ObsRequest, TokenTotals } from "@/modules/analytics/conversation-observability";
import { formatCost, formatTokens } from "./format";

// Full-width token report for one conversation (admin inbox, when "Show token usage" is on).
// Colors: the validated dark categorical palette (fixed slot order, checked on the admin's dark
// surface). Text always uses the theme's ink, never a series color; each chart has a legend and a
// table view.

const SERIES = [
  { key: "inputText", label: "Input text", color: "#3987e5" },
  { key: "inputAudio", label: "Audio in", color: "#d95926" },
  { key: "cached", label: "Cached input", color: "#199e70" },
  { key: "outputText", label: "Output text", color: "#c98500" },
  { key: "outputAudio", label: "Audio out", color: "#d55181" },
  { key: "thinking", label: "Thinking", color: "#0ca30c" },
] as const;
type SeriesKey = (typeof SERIES)[number]["key"];

/** Output splits into spoken audio, thinking and the rest (text). */
function segments(tokens: Omit<TokenTotals, "requests" | "costMicros" | "unpriced"> | ObsRequest["tokens"]): Record<SeriesKey, number> {
  return {
    inputText: tokens.inputText,
    inputAudio: tokens.inputAudio,
    cached: tokens.cached,
    outputText: Math.max(0, tokens.output - tokens.outputAudio - tokens.thinking),
    outputAudio: tokens.outputAudio,
    thinking: tokens.thinking,
  };
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const percent = (value: number) => `${(value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0)}%`;
const clock = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Dhaka", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });

/** A round axis maximum at or above `value` (1, 2, 2.5, 5 × 10ⁿ). */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-stone-600">
      {SERIES.map((series) => (
        <li key={series.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: series.color }} />
          {series.label}
        </li>
      ))}
    </ul>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-stone-200 px-3 py-2">
      <p className="text-[10.5px] text-stone-500">{label}</p>
      <p className="mt-0.5 text-[17px] font-semibold tabular-nums text-stone-900">{value}</p>
      {note ? <p className="text-[10px] text-stone-500">{note}</p> : null}
    </div>
  );
}

const tooltipStyle = { backgroundColor: "#1d1d21", borderColor: "rgb(255 255 255 / 0.14)", color: "#f7f5ef" };

/** Tokens per model request over time, stacked by token kind, grouped into session bands. */
function RequestColumns({ requests, sessionOfRequest, sessionLabels }: { requests: ObsRequest[]; sessionOfRequest: Map<string, number>; sessionLabels: string[] }) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ index: number; x: number } | null>(null);
  const max = niceMax(Math.max(...requests.map((request) => request.tokens.total)));

  // Consecutive requests of one session share a band.
  const groups: Array<{ session: number; items: Array<{ request: ObsRequest; index: number }> }> = [];
  requests.forEach((request, index) => {
    const session = sessionOfRequest.get(request.id) ?? -1;
    const last = groups.at(-1);
    if (last && last.session === session) last.items.push({ request, index });
    else groups.push({ session, items: [{ request, index }] });
  });

  const show = (index: number, target: HTMLElement) => {
    const plot = plotRef.current?.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    if (plot) setHover({ index, x: box.left - plot.left + box.width / 2 });
  };
  const hovered = hover ? requests[hover.index] : null;
  const plotWidth = plotRef.current?.clientWidth ?? 0;

  return (
    <div className="grid grid-cols-[40px_1fr] gap-x-2">
      <div className="relative h-44 text-right text-[10px] tabular-nums text-stone-500" aria-hidden>
        <span className="absolute right-0 top-0 -translate-y-1/2">{compact.format(max)}</span>
        <span className="absolute right-0 top-1/2 -translate-y-1/2">{compact.format(max / 2)}</span>
        <span className="absolute bottom-0 right-0 translate-y-1/2">0</span>
      </div>
      <div className="overflow-x-auto">
        <div ref={plotRef} className="relative h-44" style={{ minWidth: requests.length * 5 }} onMouseLeave={() => setHover(null)}>
          {/* Recessive grid. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-stone-200" />
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-stone-200" />
          <div className="absolute inset-0 flex items-stretch gap-1.5 border-b border-stone-300">
            {groups.map((group, groupIndex) => (
              <div
                key={groupIndex}
                className="flex min-w-0 items-end gap-[2px] rounded-t px-0.5"
                style={{ flexGrow: group.items.length, flexBasis: 0, backgroundColor: groupIndex % 2 ? "rgb(255 255 255 / 0.035)" : "transparent" }}
              >
                {group.items.map(({ request, index }) => {
                  const parts = segments(request.tokens);
                  return (
                    <a
                      key={request.id}
                      href={request.messageId ? `#msg-${request.messageId}` : undefined}
                      aria-label={`${clock(request.at)}: ${formatTokens(request.tokens.total)} tokens`}
                      className="flex min-w-[3px] max-w-[24px] flex-1 flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px] outline-offset-2"
                      style={{ height: `${(request.tokens.total / max) * 100}%`, opacity: hover && hover.index !== index ? 0.55 : 1 }}
                      onMouseEnter={(event) => show(index, event.currentTarget)}
                      onFocus={(event) => show(index, event.currentTarget)}
                      onBlur={() => setHover(null)}
                    >
                      {SERIES.map((series) =>
                        parts[series.key] > 0 ? (
                          <span key={series.key} className="block w-full shrink-0" style={{ flexGrow: parts[series.key], flexBasis: 0, minHeight: 1, backgroundColor: series.color }} />
                        ) : null,
                      )}
                    </a>
                  );
                })}
              </div>
            ))}
          </div>
          {hovered && hover ? (
            <div
              role="tooltip"
              className="pointer-events-none absolute top-1 z-10 w-56 rounded-lg border px-2.5 py-2 text-[10.5px] shadow-lg"
              style={{ ...tooltipStyle, left: Math.max(0, Math.min(hover.x + 10, plotWidth - 232)) }}
            >
              <p className="font-semibold">{clock(hovered.at)}</p>
              <p className="opacity-70">
                {sessionLabels[sessionOfRequest.get(hovered.id) ?? -1] ?? "No session"} · {hovered.channel} · {hovered.kind.replaceAll("_", " ")}
              </p>
              <p className="font-mono opacity-70">{hovered.model}</p>
              <ul className="mt-1 space-y-0.5 tabular-nums">
                {SERIES.map((series) => {
                  const value = segments(hovered.tokens)[series.key];
                  return value ? (
                    <li key={series.key} className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: series.color }} />
                        {series.label}
                      </span>
                      {formatTokens(value)}
                    </li>
                  ) : null;
                })}
              </ul>
              <p className="mt-1 flex justify-between border-t pt-1 font-semibold tabular-nums" style={{ borderColor: tooltipStyle.borderColor }}>
                <span>{formatTokens(hovered.tokens.total)} tokens</span>
                <span>{hovered.costMicros == null ? "unpriced" : formatCost(hovered.costMicros)}</span>
              </p>
              {hovered.attribution === "estimated" ? <p className="mt-0.5 opacity-70">Matched to its reply by time (estimated)</p> : null}
            </div>
          ) : null}
        </div>
        <div className="flex gap-1.5 pt-1 text-[10px] text-stone-500" style={{ minWidth: requests.length * 5 }} aria-hidden>
          {groups.map((group, groupIndex) => (
            <span key={groupIndex} className="min-w-0 truncate px-0.5" style={{ flexGrow: group.items.length, flexBasis: 0 }}>
              {group.session >= 0 ? `S${group.session + 1}` : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ObservabilityPanel({ data }: { data: ConversationObservability }) {
  const [asTable, setAsTable] = useState(false);
  const { totals, sessions, requests } = data;

  const sessionLabels = sessions.map((session) => `Session ${session.index + 1} · ${session.kind === "voice_call" ? "voice call" : "visit"}`);
  const sessionOfRequest = useMemo(() => {
    const map = new Map<string, number>();
    for (const request of data.requests) {
      const index = request.messageId ? data.sessionOf[request.messageId] : undefined;
      if (index !== undefined) map.set(request.id, index);
    }
    for (const session of data.sessions) for (const request of session.unattributed) map.set(request.id, session.index);
    return map;
  }, [data]);

  if (requests.length === 0) {
    return (
      <section className="rounded-xl border border-stone-200 bg-white p-4 text-[12px] text-stone-500">
        No AI usage recorded for this conversation yet.
      </section>
    );
  }

  const voice = data.byChannel.voice ?? null;
  const text = data.byChannel.text ?? null;
  const mix = segments(totals);
  const maxSessionCost = Math.max(...sessions.map((session) => session.totals.costMicros), 1);
  const exact = requests.filter((request) => request.attribution === "exact").length;
  const estimated = requests.filter((request) => request.attribution === "estimated").length;

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4" aria-label="Token usage for this conversation">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-stone-900">Token usage</h2>
        <p className="text-[10.5px] text-stone-500">
          {exact} of {requests.length} requests linked to their reply
          {estimated ? ` · ${estimated} matched by time (older data)` : ""}
          {requests.length - exact - estimated ? ` · ${requests.length - exact - estimated} counted per session only` : ""}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile
          label="Total cost"
          // $0 would read as free: with no price for any request, say so.
          value={totals.unpriced === totals.requests ? "No price set" : formatCost(totals.costMicros)} note={totals.unpriced ? `${totals.unpriced} unpriced request${totals.unpriced === 1 ? "" : "s"}` : "all requests priced"} />
        <Tile label="Total tokens" value={formatTokens(totals.total)} note={`${formatTokens(totals.inputText + totals.inputAudio + totals.cached)} in · ${formatTokens(totals.output)} out`} />
        <Tile label="Model requests" value={formatTokens(totals.requests)} note={`${sessions.length} session${sessions.length === 1 ? "" : "s"}`} />
        <Tile label="Cache hit" value={percent(data.cacheHitRate)} note={`${formatTokens(totals.cached)} cached input tokens`} />
        <Tile label="Per customer message" value={formatTokens(data.tokensPerTurn)} note={`${data.customerTurns} customer message${data.customerTurns === 1 ? "" : "s"}`} />
        <Tile
          label="Voice / text"
          value={`${percent(totals.total ? (voice?.total ?? 0) / totals.total : 0)} voice`}
          note={`voice ${formatCost(voice?.costMicros ?? 0)} · text ${formatCost(text?.costMicros ?? 0)}`}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-stone-900">Tokens per request</h3>
        <div className="flex items-center gap-3">
          <Legend />
          <button type="button" onClick={() => setAsTable((value) => !value)} className="text-[10.5px] text-stone-500 underline underline-offset-2 hover:text-stone-800">
            {asTable ? "Show as chart" : "Show as table"}
          </button>
        </div>
      </div>
      <div className="mt-2">
        {asTable ? (
          <div className="max-h-72 overflow-auto">
            <table className="w-full min-w-[760px] text-left text-[10.5px] tabular-nums text-stone-700">
              <thead className="text-stone-500">
                <tr>
                  {["Time", "Session", "Model", "Kind", ...SERIES.map((series) => series.label), "Total", "Cost"].map((label) => (
                    <th key={label} scope="col" className="py-1 pr-2 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => {
                  const parts = segments(request.tokens);
                  const session = sessionOfRequest.get(request.id);
                  return (
                    <tr key={request.id} className="border-t border-stone-200">
                      <td className="py-1 pr-2 whitespace-nowrap">
                        {request.messageId ? (
                          <a href={`#msg-${request.messageId}`} className="underline-offset-2 hover:underline">
                            {clock(request.at)}
                          </a>
                        ) : (
                          clock(request.at)
                        )}
                      </td>
                      <td className="py-1 pr-2">{session !== undefined ? `S${session + 1}` : "–"}</td>
                      <td className="py-1 pr-2 font-mono">{request.model}</td>
                      <td className="py-1 pr-2">
                        {request.channel} · {request.kind.replaceAll("_", " ")}
                      </td>
                      {SERIES.map((series) => (
                        <td key={series.key} className="py-1 pr-2">
                          {formatTokens(parts[series.key])}
                        </td>
                      ))}
                      <td className="py-1 pr-2 font-semibold">{formatTokens(request.tokens.total)}</td>
                      <td className="py-1 pr-2">{request.costMicros == null ? "unpriced" : formatCost(request.costMicros)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <RequestColumns requests={requests} sessionOfRequest={sessionOfRequest} sessionLabels={sessionLabels} />
        )}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="text-[12px] font-semibold text-stone-900">Cost per session</h3>
          <ul className="mt-2 space-y-1.5">
            {sessions.map((session) => (
              <li key={session.index} className="grid grid-cols-[96px_1fr] items-center gap-2 text-[10.5px]">
                <a href={session.messageIds[0] ? `#msg-${session.messageIds[0]}` : undefined} className="truncate text-stone-600 hover:underline">
                  S{session.index + 1} · {session.kind === "voice_call" ? "🎙 call" : "visit"}
                </a>
                <span className="flex items-center gap-2">
                  {session.totals.costMicros > 0 ? (
                    <span
                      className="h-3 rounded-r-[4px]"
                      style={{ width: `calc(${(session.totals.costMicros / maxSessionCost) * 100}% - 7rem)`, minWidth: 2, backgroundColor: SERIES[0].color }}
                    />
                  ) : null}
                  <span className="shrink-0 tabular-nums text-stone-700">
                    {formatCost(session.totals.costMicros)} · {compact.format(session.totals.total)} tok
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-[12px] font-semibold text-stone-900">Token mix</h3>
          <div className="mt-2 flex h-3.5 w-full gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label="Share of tokens by kind (listed below)">
            {SERIES.map((series) =>
              mix[series.key] > 0 ? <span key={series.key} style={{ flexGrow: mix[series.key], flexBasis: 0, backgroundColor: series.color }} /> : null,
            )}
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10.5px] text-stone-600 sm:grid-cols-3">
            {SERIES.map((series) => (
              <li key={series.key} className="flex items-center justify-between gap-2 tabular-nums">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: series.color }} />
                  {series.label}
                </span>
                <span className="text-stone-800">
                  {formatTokens(mix[series.key])} <span className="text-stone-500">({percent(totals.total ? mix[series.key] / totals.total : 0)})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="text-[12px] font-semibold text-stone-900">By model</h3>
          <table className="mt-1.5 w-full text-left text-[10.5px] tabular-nums text-stone-700">
            <thead className="text-stone-500">
              <tr>
                {["Model", "Requests", "Input", "Cached", "Output", "Cost"].map((label) => (
                  <th key={label} scope="col" className="py-1 pr-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.byModel.map((row) => (
                <tr key={`${row.providerId}:${row.model}`} className="border-t border-stone-200">
                  <td className="py-1 pr-2 font-mono">{row.model}</td>
                  <td className="py-1 pr-2">{row.totals.requests}</td>
                  <td className="py-1 pr-2">{formatTokens(row.totals.inputText + row.totals.inputAudio)}</td>
                  <td className="py-1 pr-2">{formatTokens(row.totals.cached)}</td>
                  <td className="py-1 pr-2">{formatTokens(row.totals.output)}</td>
                  <td className="py-1 pr-2">
                    {formatCost(row.totals.costMicros)}
                    {row.totals.unpriced ? <span className="text-amber-500"> · {row.totals.unpriced} unpriced</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="text-[12px] font-semibold text-stone-900">Most expensive requests</h3>
          <ol className="mt-1.5 space-y-1 text-[10.5px] text-stone-700">
            {data.topRequests.map((request) => (
              <li key={request.id} className="flex justify-between gap-2 border-t border-stone-200 pt-1 tabular-nums">
                {request.messageId ? (
                  <a href={`#msg-${request.messageId}`} className="truncate underline-offset-2 hover:underline">
                    {clock(request.at)} · {request.channel} · {request.kind.replaceAll("_", " ")}
                  </a>
                ) : (
                  <span className="truncate">
                    {clock(request.at)} · {request.channel} · {request.kind.replaceAll("_", " ")}
                  </span>
                )}
                <span className="shrink-0">
                  {formatTokens(request.tokens.total)} tok · {request.costMicros == null ? "unpriced" : formatCost(request.costMicros)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
