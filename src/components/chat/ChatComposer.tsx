"use client";

import { useEffect, useRef } from "react";

export type PendingAttachment = {
  localId: string;
  name: string;
  kind: "image" | "audio" | "file";
  previewUrl: string | null;
  status: "uploading" | "ready" | "error";
  uploadId?: string;
  error?: string;
};

type ChatComposerProps = {
  draft: string;
  setDraft: (value: string) => void;
  onSend: (text: string) => void;
  disabled?: boolean;
  active?: boolean;
  accent: string;
  placeholder: string;
  attachmentsEnabled: boolean;
  voiceEnabled: boolean;
  voiceSupported: boolean;
  recording: boolean;
  recordingMs: number;
  liveTranscript: string;
  pending: PendingAttachment[];
  onPickFiles: (files: FileList) => void;
  onRemovePending: (localId: string) => void;
  onStartVoice: () => void;
  onStopVoice: () => void;
  onCancelVoice: () => void;
};

function formatClock(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ChatComposer({
  draft,
  setDraft,
  onSend,
  disabled,
  active,
  accent,
  placeholder,
  attachmentsEnabled,
  voiceEnabled,
  voiceSupported,
  recording,
  recordingMs,
  liveTranscript,
  pending,
  onPickFiles,
  onRemovePending,
  onStartVoice,
  onStopVoice,
  onCancelVoice,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active) {
      const timer = window.setTimeout(() => textareaRef.current?.focus(), 140);
      return () => window.clearTimeout(timer);
    }
  }, [active]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [draft]);

  const uploading = pending.some((item) => item.status === "uploading");
  const hasReady = pending.some((item) => item.status === "ready");
  const canSend = !disabled && !uploading && (draft.trim().length > 0 || hasReady);

  const submit = () => {
    if (canSend) onSend(draft);
  };

  if (recording) {
    return (
      <div className="border-t border-stone-200 bg-white px-3 py-3 animate-fade-up">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancelVoice}
            aria-label="Cancel voice message"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-stone-200 text-stone-500 transition hover:bg-stone-50"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
            </svg>
          </button>
          <div className="min-w-0 flex-1" role="status" aria-live="polite">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-red-400" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              </span>
              <span className="font-mono text-[12.5px] text-stone-700">{formatClock(recordingMs)}</span>
              <span className="flex h-5 flex-1 items-center gap-[3px] overflow-hidden" aria-hidden="true">
                {Array.from({ length: 24 }).map((_, index) => (
                  <span
                    key={index}
                    className="w-[3px] animate-typing-dot rounded-full"
                    style={{ height: `${6 + ((index * 37) % 14)}px`, backgroundColor: accent, animationDelay: `${(index % 8) * 90}ms` }}
                  />
                ))}
              </span>
            </div>
            <p className="mt-1 truncate text-[11.5px] text-stone-500">{liveTranscript || "Listening… speak now"}</p>
          </div>
          <button
            type="button"
            onClick={onStopVoice}
            aria-label="Send voice message"
            className="flex h-10 w-10 shrink-0 animate-pop items-center justify-center rounded-xl text-white shadow-sm transition hover:brightness-110"
            style={{ backgroundColor: accent }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-stone-200 bg-white px-3 py-2.5">
      {pending.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {pending.map((item) => (
            <div
              key={item.localId}
              className={`relative flex animate-pop items-center gap-1.5 rounded-lg border px-1.5 py-1 text-[11px] ${
                item.status === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-stone-200 bg-stone-50 text-stone-700"
              }`}
              title={item.error}
            >
              {item.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.previewUrl} alt="" className={`h-8 w-8 rounded object-cover ${item.status === "uploading" ? "opacity-50" : ""}`} />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded bg-white text-[10px] font-semibold uppercase text-stone-500">
                  {item.kind === "audio" ? "🎤" : "PDF"}
                </span>
              )}
              <span className="max-w-[110px] truncate">{item.status === "error" ? item.error : item.name}</span>
              {item.status === "uploading" ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" aria-label="Uploading" />
              ) : (
                <button type="button" onClick={() => onRemovePending(item.localId)} aria-label={`Remove ${item.name}`} className="px-0.5 text-stone-400 hover:text-stone-700">
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex items-end gap-1.5"
      >
        {attachmentsEnabled ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) onPickFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || pending.length >= 4}
              aria-label="Attach an image or PDF"
              className="flex h-10 w-9 shrink-0 items-center justify-center rounded-xl text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
              </svg>
            </button>
          </>
        ) : null}

        <label htmlFor="nokshi-composer" className="sr-only">
          Message the shopping assistant
        </label>
        <textarea
          id="nokshi-composer"
          ref={textareaRef}
          rows={1}
          maxLength={2000}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          onPaste={(event) => {
            if (!attachmentsEnabled) return;
            const files = event.clipboardData.files;
            if (files.length > 0) {
              event.preventDefault();
              onPickFiles(files);
            }
          }}
          placeholder={placeholder}
          className="max-h-[120px] min-h-[40px] flex-1 resize-none rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-[13px] leading-snug text-stone-800 transition placeholder:text-stone-400 focus:border-stone-300 focus:bg-white focus:outline-none disabled:opacity-60"
        />

        {voiceEnabled && voiceSupported && !draft.trim() && !hasReady ? (
          <button
            type="button"
            onClick={onStartVoice}
            disabled={disabled}
            aria-label="Record a voice message"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white transition hover:brightness-110 active:scale-95 disabled:opacity-40"
            style={{ backgroundColor: accent }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
            </svg>
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send message"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: accent }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
          </button>
        )}
      </form>
      <p className="mt-1.5 text-center text-[10px] text-stone-400">
        {voiceEnabled && voiceSupported ? "Type, send a voice note, or attach a photo · " : ""}Prices confirmed by the store
      </p>
    </div>
  );
}
