"use client";

import { useActionState, useEffect, useRef } from "react";
import { replyAction, type ReplyState } from "@/app/admin/inbox-actions";

const QUICK_REPLIES = [
  "Thanks for waiting! I'm looking into this now.",
  "Could you share your order number and the phone number you ordered with?",
  "Sorry about that. We'll arrange a replacement at no cost.",
  "Is there anything else I can help you with?",
];

export function AgentReplyBox({ conversationId, disabled }: { conversationId: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState<ReplyState, FormData>(replyAction, {});
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state.ok && textRef.current) {
      textRef.current.value = "";
      textRef.current.focus();
    }
  }, [state.ok, state.sentAt]);

  return (
    <form action={action} className="border-t border-stone-200 bg-white p-3">
      <input type="hidden" name="conversationId" value={conversationId} />
      <div className="mb-2 flex flex-wrap gap-1.5">
        {QUICK_REPLIES.map((reply) => (
          <button
            key={reply}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (textRef.current) {
                textRef.current.value = reply;
                textRef.current.focus();
              }
            }}
            className="rounded-full border border-stone-200 px-2.5 py-1 text-[10.5px] text-stone-600 transition hover:border-stone-300 hover:bg-stone-50 disabled:opacity-40"
          >
            {reply.length > 42 ? `${reply.slice(0, 40)}…` : reply}
          </button>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          ref={textRef}
          name="text"
          rows={2}
          disabled={disabled}
          placeholder={disabled ? "This conversation is closed." : "Reply as the store. Sending takes over from the assistant."}
          aria-label="Reply to customer"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          className="min-h-[44px] flex-1 resize-none rounded-xl border border-stone-300 px-3 py-2 text-[12.5px] focus:border-stone-500 focus:outline-none disabled:bg-stone-50"
        />
        <button
          type="submit"
          disabled={pending || disabled}
          className="rounded-xl bg-stone-900 px-4 py-2.5 text-[12px] font-semibold text-white transition hover:bg-stone-800 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
      {state.error ? <p className="mt-1 text-[11px] text-red-600">{state.error}</p> : null}
    </form>
  );
}
