import type { ActionError } from "./errors";
import { errorMessage, t, type MessageKey } from "./i18n";

// User-facing wording for sign-in and action failures. Generic by design: never reveals
// whether an account, workspace, or record exists.

const SIGN_IN: Partial<Record<string, MessageKey>> = {
  invalid_credentials: "auth.fail.invalid_credentials",
  too_many_attempts: "auth.fail.too_many_attempts",
  RATE_LIMITED: "auth.fail.too_many_attempts",
  popup_closed: "auth.fail.popup_closed",
  network: "auth.fail.network",
  FORBIDDEN: "auth.fail.no_access",
  TENANT_SUSPENDED: "app.suspended.body",
  REAUTH_REQUIRED: "error.REAUTH_REQUIRED",
};

export function signInFailureMessage(failure: {
  reason: string;
  requestId?: string | undefined;
}): string {
  const key = SIGN_IN[failure.reason] ?? "error.INTERNAL";
  if (key !== "error.INTERNAL" || !failure.requestId) return t(key);
  return `${t(key)} ${t("common.supportReference", { requestId: failure.requestId })}`;
}

/** Window event fired when an action reports an expired/revoked session (06 §9). */
export const SESSION_EXPIRED_EVENT = "crm:session-expired";

export function actionErrorMessage(error: ActionError): string {
  if (error.code === "UNAUTHENTICATED" && typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  const base = errorMessage(error.code);
  return error.code === "INTERNAL"
    ? `${base} ${t("common.supportReference", { requestId: error.requestId })}`
    : base;
}
