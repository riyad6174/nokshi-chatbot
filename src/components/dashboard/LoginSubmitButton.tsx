"use client";

import { useFormStatus } from "react-dom";
import { LuArrowRight, LuLoaderCircle } from "react-icons/lu";

/** The sign-in button: shows progress (and can't be pressed twice) while the login is processing. */
export function LoginSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="group mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#f3e1b8] via-[#d8b878] to-[#b18c4b] px-4 py-2.5 text-[13px] font-semibold text-[#191307] shadow-[0_18px_40px_-18px_rgba(216,184,120,0.8)] transition hover:-translate-y-px hover:brightness-105 disabled:cursor-wait disabled:opacity-80 disabled:hover:translate-y-0 disabled:hover:brightness-100"
    >
      {pending ? (
        <>
          <LuLoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          Signing in…
        </>
      ) : (
        <>
          Sign in
          <LuArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
        </>
      )}
    </button>
  );
}
