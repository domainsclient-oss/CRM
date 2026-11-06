"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { getFreshIdToken } from "@crm/shared/auth-client";
import { errorMessage, t } from "@crm/shared/i18n";
import { acceptInvitationAction } from "@/features/auth/actions";
import { signInFailureMessage } from "@crm/shared/auth-messages";

interface Props {
  token: string;
  email: string;
  role: string;
  accountExists: boolean;
}

export function AcceptForm({ token, email, role, accountExists }: Props) {
  const [status, setStatus] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const errorRef = useRef<HTMLParagraphElement>(null);

  function showError(message: string) {
    setStatus("idle");
    setError(message);
    requestAnimationFrame(() => errorRef.current?.focus());
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus("pending");
    setError(null);
    setFieldErrors({});

    let payload: Record<string, string> = { token };
    if (accountExists) {
      const fresh = await getFreshIdToken(email, String(form.get("password")));
      if (!fresh.ok) return showError(signInFailureMessage(fresh));
      payload = { token, idToken: fresh.idToken };
    } else {
      const password = String(form.get("password"));
      if (password !== String(form.get("confirm"))) {
        setFieldErrors({ confirm: [t("invite.mismatch")] });
        return setStatus("idle");
      }
      payload = { token, displayName: String(form.get("displayName")), password };
    }

    const result = await acceptInvitationAction(payload);
    if (result.ok) return setStatus("done");
    if (result.error.fieldErrors) setFieldErrors(result.error.fieldErrors);
    showError(
      result.error.code === "NOT_FOUND" ? t("invite.invalid") : errorMessage(result.error.code),
    );
  }

  if (status === "done") {
    return (
      <div className="flex flex-col gap-4" role="status">
        <h1 className="text-xl font-semibold">{t("invite.title")}</h1>
        <p className="text-sm">{t("invite.accepted")}</p>
        <Button asChild>
          <Link href="/login">{t("auth.signIn.submit")}</Link>
        </Button>
      </div>
    );
  }

  const fieldError = (name: string) =>
    fieldErrors[name]?.length ? (
      <p id={`${name}-error`} className="text-sm text-destructive">
        {fieldErrors[name]!.join(" ")}
      </p>
    ) : null;
  const described = (name: string, hint?: string) =>
    [fieldErrors[name]?.length ? `${name}-error` : null, hint].filter(Boolean).join(" ") ||
    undefined;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <h1 className="text-xl font-semibold">{t("invite.title")}</h1>
      <p className="text-sm text-muted-foreground">
        {t("invite.body", { email })} {t("invite.role", { role })}
      </p>
      {error ? (
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="text-sm text-destructive outline-none"
        >
          {error}
        </p>
      ) : null}

      {accountExists ? (
        <>
          <p className="text-sm">{t("invite.existing")}</p>
          <input
            type="email"
            name="username"
            autoComplete="username"
            value={email}
            readOnly
            hidden
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <Button type="submit" disabled={status === "pending"}>
            {t("invite.acceptExisting")}
          </Button>
        </>
      ) : (
        <>
          <input
            type="email"
            name="username"
            autoComplete="username"
            value={email}
            readOnly
            hidden
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="displayName">{t("invite.displayName")}</Label>
            <Input
              id="displayName"
              name="displayName"
              autoComplete="name"
              required
              aria-invalid={Boolean(fieldErrors.displayName?.length)}
              aria-describedby={described("displayName")}
            />
            {fieldError("displayName")}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t("invite.newPassword")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              aria-invalid={Boolean(fieldErrors.password?.length)}
              aria-describedby={described("password", "password-hint")}
            />
            <p id="password-hint" className="text-xs text-muted-foreground">
              {t("invite.passwordHint")}
            </p>
            {fieldError("password")}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm">{t("invite.confirmPassword")}</Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              aria-invalid={Boolean(fieldErrors.confirm?.length)}
              aria-describedby={described("confirm")}
            />
            {fieldError("confirm")}
          </div>
          <Button type="submit" disabled={status === "pending"}>
            {t("invite.create")}
          </Button>
        </>
      )}
    </form>
  );
}
