"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { errorMessage, t } from "@crm/shared/i18n";
import { requestPasswordResetAction } from "@/features/auth/actions";

export function ResetForm() {
  const [status, setStatus] = useState<"idle" | "pending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("pending");
    setError(null);
    const email = String(new FormData(event.currentTarget).get("email"));
    const result = await requestPasswordResetAction({ email });
    if (result.ok) return setStatus("sent");
    setStatus("idle");
    setError(errorMessage(result.error.code));
  }

  if (status === "sent") {
    return (
      <div className="flex flex-col gap-4" role="status">
        <h1 className="text-xl font-semibold">{t("auth.reset.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("auth.reset.sent")}</p>
        <Link href="/login" className="text-sm underline-offset-4 hover:underline">
          {t("auth.reset.back")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <h1 className="text-xl font-semibold">{t("auth.reset.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("auth.reset.body")}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t("auth.email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <Button type="submit" disabled={status === "pending"}>
        {t("auth.reset.submit")}
      </Button>
      <Link
        href="/login"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        {t("auth.reset.back")}
      </Link>
    </form>
  );
}
