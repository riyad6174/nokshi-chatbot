import { LuCircleAlert, LuCircleCheck } from "react-icons/lu";

export function AdminBanner({
  error,
  saved,
  savedMessage = "Changes saved.",
}: {
  error?: string;
  saved?: string;
  savedMessage?: string;
}) {
  if (error) {
    return (
      <div
        role="alert"
        className="mb-5 flex items-start gap-2.5 rounded-2xl border border-[#e16a7b]/25 bg-[#e16a7b]/10 px-4 py-3 text-[12.5px] text-[#fda4af] shadow-[0_18px_40px_-24px_rgba(0,0,0,0.9)] backdrop-blur-xl animate-fade-up"
      >
        <LuCircleAlert className="mt-px h-4 w-4 shrink-0" aria-hidden />
        <span>{error}</span>
      </div>
    );
  }
  if (saved) {
    return (
      <div
        role="status"
        className="mb-5 flex items-start gap-2.5 rounded-2xl border border-[#6fbf8a]/25 bg-[#6fbf8a]/10 px-4 py-3 text-[12.5px] text-[#a7d8b4] shadow-[0_18px_40px_-24px_rgba(0,0,0,0.9)] backdrop-blur-xl animate-fade-up"
      >
        <LuCircleCheck className="mt-px h-4 w-4 shrink-0" aria-hidden />
        <span>{savedMessage}</span>
      </div>
    );
  }
  return null;
}
