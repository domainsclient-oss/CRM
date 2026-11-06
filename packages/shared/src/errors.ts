// Error contract shared by server actions, route handlers, and UI (requirements/02 §8.1).
// Isomorphic: safe to import from client and server code.

export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "RATE_LIMITED",
  "PLAN_LIMIT_EXCEEDED",
  "TENANT_SUSPENDED",
  "BILLING_READ_ONLY",
  "REAUTH_REQUIRED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type FieldErrors = Record<string, string[]>;

export interface ActionError {
  code: ErrorCode;
  /** User-safe message. Never contains stack traces, internal IDs, or other tenants' data. */
  message: string;
  fieldErrors?: FieldErrors;
  requestId: string;
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: ActionError): ActionResult<never> {
  return { ok: false, error };
}

/** HTTP status for route handlers. Cross-tenant access is reported as NOT_FOUND (404), never 403. */
export const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PLAN_LIMIT_EXCEEDED: 403,
  TENANT_SUSPENDED: 403,
  BILLING_READ_ONLY: 403,
  REAUTH_REQUIRED: 401,
  INTERNAL: 500,
};

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}
