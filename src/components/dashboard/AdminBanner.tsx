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
      <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] text-red-700">
        {error}
      </div>
    );
  }
  if (saved) {
    return (
      <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[12px] text-emerald-800">
        {savedMessage}
      </div>
    );
  }
  return null;
}
