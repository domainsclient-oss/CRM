"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { Input } from "@crm/ui/components/input";
import { t } from "@crm/shared/i18n";
import { MAX_TAGS_PER_RECORD, normalizeTag } from "@crm/shared/records/normalize";

// TagInput (FR-REC-002): Enter or comma adds a tag; suggestions come from the workspace catalog.
// Normalization mirrors the server (which is authoritative).

export function TagInput({
  id,
  value,
  onChange,
  suggestions,
  invalid,
  describedBy,
}: {
  id: string;
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  invalid?: boolean;
  describedBy?: string;
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();

  function add(raw: string) {
    const tag = normalizeTag(raw.replace(/,/g, ""));
    // A duplicate still clears the input, so the next tag isn't appended to it.
    if (tag && value.includes(tag)) return setDraft("");
    if (!tag || value.length >= MAX_TAGS_PER_RECORD) return;
    onChange([...value, tag]);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
    } else if (event.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("field.tags")}>
          {value.map((tag) => (
            <li
              key={tag}
              className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-sm"
            >
              {tag}
              <button
                type="button"
                className="inline-flex size-6 items-center justify-center rounded-full hover:bg-background"
                aria-label={t("record.removeTag", { tag })}
                onClick={() => onChange(value.filter((v) => v !== tag))}
              >
                <span aria-hidden>×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        id={id}
        value={draft}
        list={listId}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft && add(draft)}
        maxLength={32}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
      />
      <datalist id={listId}>
        {suggestions
          .filter((s) => !value.includes(s))
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
    </div>
  );
}
