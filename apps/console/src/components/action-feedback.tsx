"use client";

import Link from "next/link";
import type { ActionResult } from "@crm/shared/errors";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import { t } from "@crm/shared/i18n";

/** Shows an action's failure; re-auth failures get a sign-in link (FR-AUTH-008 AC3). */
export function ActionError({ result }: { result: ActionResult<unknown> | null }) {
  if (!result || result.ok) return null;
  if (result.error.code === "REAUTH_REQUIRED") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("console.reauth")}{" "}
        <Link href="/login" className="underline underline-offset-4">
          {t("console.reauth.link")}
        </Link>
      </p>
    );
  }
  return (
    <p role="alert" className="text-sm text-destructive">
      {actionErrorMessage(result.error)}
    </p>
  );
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID().replace(/-/g, "");
}
