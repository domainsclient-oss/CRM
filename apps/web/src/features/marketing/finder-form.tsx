"use client";

import { useState, type FormEvent } from "react";
import { FINDER_FORM } from "@crm/shared/content/marketing";
import { errorMessage } from "@crm/shared/i18n/base";
import { findWorkspaceAction } from "./actions";
import { buttonClass, fieldClass, labelClass } from "./form-styles";

export function FinderForm() {
  const [status, setStatus] = useState<"idle" | "pending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("pending");
    setError(null);
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    const result = await findWorkspaceAction({ email });
    if (result.ok) return setStatus("sent");
    setStatus("idle");
    setError(errorMessage(result.error.code));
  }

  if (status === "sent") {
    return (
      <p role="status" className="rounded-xl border p-4">
        {FINDER_FORM.sent}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className={labelClass}>
          {FINDER_FORM.email}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={`h-9 ${fieldClass}`}
        />
      </div>
      <button type="submit" disabled={status === "pending"} className={buttonClass}>
        {status === "pending" ? FINDER_FORM.sending : FINDER_FORM.submit}
      </button>
    </form>
  );
}
