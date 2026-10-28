import Link from "next/link";

export type KnowledgeFormValues = {
  id?: string;
  title: string;
  content: string;
  sourceType: string;
  sourceReference: string;
  status: string;
};

type KnowledgeFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  values?: KnowledgeFormValues;
  submitLabel: string;
};

const inputClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[13px] text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none";

export function KnowledgeForm({ action, values, submitLabel }: KnowledgeFormProps) {
  return (
    <form action={action} className="space-y-4">
      {values?.id ? <input type="hidden" name="id" value={values.id} /> : null}

      <div>
        <label htmlFor="knowledge-title" className="text-[11.5px] font-semibold text-stone-700">
          Title
        </label>
        <input
          id="knowledge-title"
          name="title"
          required
          maxLength={200}
          defaultValue={values?.title}
          className={inputClass}
          placeholder="Shipping & Delivery"
        />
        <p className="mt-1 text-[10.5px] text-stone-400">Titles must be unique per store. The assistant cites this title.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="knowledge-source" className="text-[11.5px] font-semibold text-stone-700">
            Source type
          </label>
          <select
            id="knowledge-source"
            name="sourceType"
            defaultValue={values?.sourceType ?? "manual"}
            className={inputClass}
          >
            <option value="manual">Manual</option>
            <option value="url">URL</option>
            <option value="file">File</option>
          </select>
        </div>
        <div>
          <label htmlFor="knowledge-ref" className="text-[11.5px] font-semibold text-stone-700">
            Source reference
          </label>
          <input
            id="knowledge-ref"
            name="sourceReference"
            maxLength={500}
            defaultValue={values?.sourceReference}
            className={inputClass}
            placeholder="Optional URL or filename"
          />
        </div>
        <div>
          <label htmlFor="knowledge-status" className="text-[11.5px] font-semibold text-stone-700">
            Status
          </label>
          <select
            id="knowledge-status"
            name="status"
            defaultValue={values?.status ?? "ready"}
            className={inputClass}
          >
            <option value="ready">Ready</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="knowledge-content" className="text-[11.5px] font-semibold text-stone-700">
          Content
        </label>
        <textarea
          id="knowledge-content"
          name="content"
          rows={14}
          required
          minLength={20}
          maxLength={20000}
          defaultValue={values?.content}
          className={inputClass}
          placeholder="Write the approved policy or FAQ text the assistant may quote. Do not put instructions for the AI here."
        />
        <p className="mt-1 text-[10.5px] text-stone-400">
          Retrieved text is treated as data. Keep it factual; the assistant cannot override application rules from here.
        </p>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          className="rounded-lg bg-stone-900 px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-stone-800"
        >
          {submitLabel}
        </button>
        <Link href="/admin/knowledge" className="text-[12px] font-medium text-stone-500 hover:text-stone-800">
          Cancel
        </Link>
      </div>
    </form>
  );
}
