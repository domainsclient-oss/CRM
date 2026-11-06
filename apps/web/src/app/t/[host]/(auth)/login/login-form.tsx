"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { signInWithPassword } from "@crm/shared/auth-client";
import { signInFailureMessage } from "@crm/shared/auth-messages";
import { t } from "@crm/shared/i18n";

export function LoginForm({ workspaceName }: { workspaceName: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const router = useRouter();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const result = await signInWithPassword(
      String(form.get("email")),
      String(form.get("password")),
    );
    if (result.ok) {
      router.replace("/");
      router.refresh(); // re-render server components with the new session cookie
      return;
    }
    setPending(false);
    setError(signInFailureMessage(result));
    requestAnimationFrame(() => errorRef.current?.focus());
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <h1 className="text-xl font-semibold">
        {t("auth.signIn.title", { workspace: workspaceName })}
      </h1>
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
      <Link
        href="/reset-password"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        {t("auth.signIn.forgot")}
      </Link>
    </form>
  );
}
