"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { CONTACT_FORM, TEAM_SIZES } from "@crm/shared/content/marketing";
import { errorMessage } from "@crm/shared/i18n/base";
import { submitContactAction } from "./actions";
import { buttonClass, fieldClass, labelClass } from "./form-styles";

export function ContactForm() {
  const [status, setStatus] = useState<"idle" | "pending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("pending");
    setError(null);
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "");
    const result = await submitContactAction({
      name: value("name"),
      email: value("email"),
      company: value("company"),
      teamSize: value("teamSize"),
      message: value("message"),
      website: value("website"),
    });
    if (result.ok) return setStatus("sent");
    setStatus("idle");
    setError(errorMessage(result.error.code));
  }

  if (status === "sent") {
    return (
      <p role="status" className="rounded-xl border p-4">
        {CONTACT_FORM.thanks}
      </p>
    );
  }

  const field = (id: string, label: string, control: ReactNode) => (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {control}
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {field(
        "name",
        CONTACT_FORM.name,
        <input
          id="name"
          name="name"
          autoComplete="name"
          required
          maxLength={100}
          className={`h-9 ${fieldClass}`}
        />,
      )}
      {field(
        "email",
        CONTACT_FORM.email,
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={`h-9 ${fieldClass}`}
        />,
      )}
      {field(
        "company",
        CONTACT_FORM.company,
        <input
          id="company"
          name="company"
          autoComplete="organization"
          required
          maxLength={120}
          className={`h-9 ${fieldClass}`}
        />,
      )}
      {field(
        "teamSize",
        CONTACT_FORM.teamSize,
        <select id="teamSize" name="teamSize" required className={`h-9 ${fieldClass}`}>
          {TEAM_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>,
      )}
      {field(
        "message",
        CONTACT_FORM.message,
        <textarea id="message" name="message" rows={4} maxLength={2000} className={fieldClass} />,
      )}
      {/* Honeypot: off-screen and skipped by keyboard and assistive tech. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">{CONTACT_FORM.website}</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <button type="submit" disabled={status === "pending"} className={buttonClass}>
        {status === "pending" ? CONTACT_FORM.sending : CONTACT_FORM.submit}
      </button>
    </form>
  );
}
