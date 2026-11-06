import "server-only";
import { errorMessage } from "@crm/shared/i18n";
import type { ActionError, ErrorCode, FieldErrors } from "@crm/shared/errors";
import { ZodError } from "zod";
import { logger } from "./logger";

// Typed server errors (requirements/02 §8.1). Throw these from services; wrappers
// convert them to ActionResult / HTTP responses with user-safe messages only.

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors: FieldErrors | undefined;

  constructor(code: ErrorCode, internalMessage?: string, fieldErrors?: FieldErrors) {
    super(internalMessage ?? code);
    this.name = "AppError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export class UnauthenticatedError extends AppError {
  constructor(detail?: string) {
    super("UNAUTHENTICATED", detail);
  }
}
export class ForbiddenError extends AppError {
  constructor(detail?: string) {
    super("FORBIDDEN", detail);
  }
}
/** Also used for cross-tenant access, so existence is never revealed. */
export class NotFoundError extends AppError {
  constructor(detail?: string) {
    super("NOT_FOUND", detail);
  }
}
export class ValidationError extends AppError {
  constructor(fieldErrors: FieldErrors, detail?: string) {
    super("VALIDATION", detail, fieldErrors);
  }
}
export class ConflictError extends AppError {
  constructor(detail?: string) {
    super("CONFLICT", detail);
  }
}

function fieldErrorsFromZod(error: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/**
 * Convert any thrown value into a user-safe ActionError.
 * Known errors keep their code; unknown errors are logged and reported as INTERNAL.
 */
export function toActionError(error: unknown, requestId: string): ActionError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: errorMessage(error.code),
      requestId,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    };
  }
  if (error instanceof ZodError) {
    return {
      code: "VALIDATION",
      message: errorMessage("VALIDATION"),
      fieldErrors: fieldErrorsFromZod(error),
      requestId,
    };
  }
  logger.error("unhandled_error", { requestId, error });
  return { code: "INTERNAL", message: errorMessage("INTERNAL"), requestId };
}
