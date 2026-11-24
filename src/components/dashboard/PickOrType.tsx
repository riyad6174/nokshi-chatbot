"use client";

import { useState } from "react";

export type PickOption = { id: string; label?: string; group?: string };

type Props = {
  id: string;
  name: string;
  options: PickOption[];
  /** Controlled value (with onChange); otherwise the field keeps its own state from defaultValue. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  className: string;
  placeholder?: string;
  required?: boolean;
  mono?: boolean;
};

const OTHER = "__other__";

/**
 * A dropdown that always shows every option (a <datalist> only suggests entries matching what's
 * already typed, so a filled-in field showed one choice or none), with "Other…" for any name that
 * isn't listed. The current value is always kept, even when the list doesn't include it.
 */
export function PickOrType({ id, name, options, value, defaultValue = "", onChange, className, placeholder, required, mono }: Props) {
  const [own, setOwn] = useState(defaultValue);
  const current = value ?? own;
  // Starts as a dropdown whenever there are options (e.g. once Test loads the models); a text box
  // only while there are none, or after picking "Other".
  const [typing, setTyping] = useState(false);
  const set = (next: string) => {
    if (value === undefined) setOwn(next);
    onChange?.(next);
  };

  if (typing || options.length === 0) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          name={name}
          value={current}
          onChange={(event) => set(event.target.value)}
          placeholder={placeholder}
          required={required}
          className={`${className} ${mono ? "font-mono" : ""}`}
          autoComplete="off"
          spellCheck={false}
        />
        {options.length > 0 ? (
          <button
            type="button"
            onClick={() => setTyping(false)}
            className="mt-1 shrink-0 rounded-md border border-stone-300 px-2 py-1.5 text-[10.5px] text-stone-600 hover:bg-stone-50"
          >
            List
          </button>
        ) : null}
      </div>
    );
  }

  const listed = options.some((option) => option.id === current);
  const all = current && !listed ? [{ id: current, label: `${current} (current)` }, ...options] : options;
  const groups = [...new Set(all.map((option) => option.group ?? ""))];

  const render = (option: PickOption) => (
    <option key={option.id} value={option.id}>
      {option.label ?? option.id}
    </option>
  );

  return (
    <select
      id={id}
      name={name}
      value={current}
      required={required}
      onChange={(event) => {
        if (event.target.value === OTHER) setTyping(true);
        else set(event.target.value);
      }}
      className={`${className} ${mono ? "font-mono" : ""}`}
    >
      {!current ? <option value="">Choose…</option> : null}
      {groups.length > 1
        ? groups.map((group) => (
            <optgroup key={group || "other"} label={group || "Other"}>
              {all.filter((option) => (option.group ?? "") === group).map(render)}
            </optgroup>
          ))
        : all.map(render)}
      <option value={OTHER}>Other (type a name)…</option>
    </select>
  );
}
