"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { signInWithGoogle, signInWithPassword, type SignInResult } from "@crm/shared/auth-client";
import { signInFailureMessage } from "@crm/shared/auth-messages";
import { t } from "@crm/shared/i18n";

/**
 * Console sign-in. Platform staff: Google only (FR-AUTH-008 AC1, server enforces domain).
 * Agency staff: password or Google.
 */
export function SignInForm({
  title,
  body,
  allowPassword,
  notice,
}: {
  title: string;
  body: string;
  allowPassword: boolean;
  notice?: string | undefined;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  async function finish(result: SignInResult) {
    if (result.ok) {
      router.replace("/");
      router.refresh();
      return;
    }
    setPending(false);
    setError(signInFailureMessage(result));
    requestAnimationFrame(() => errorRef.current?.focus());
  }

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    await finish(await signInWithPassword(String(form.get("email")), String(form.get("password"))));
  }

  async function onGoogle() {
    setPending(true);
    setError(null);
    await finish(await signInWithGoogle());
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
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
      <Button
        type="button"
        variant={allowPassword ? "outline" : "default"}
        onClick={onGoogle}
        disabled={pending}
      >
        {t("auth.signIn.google")}
      </Button>
      {allowPassword ? (
        <form onSubmit={onPassword} className="flex flex-col gap-4" noValidate>
          <p className="text-center text-xs text-muted-foreground">{t("auth.signIn.or")}</p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
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
          <Button type="submit" disabled={pending}>
            {pending ? t("auth.signIn.pending") : t("auth.signIn.submit")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
