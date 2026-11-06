import "server-only";
import { randomBytes } from "node:crypto";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Short, URL-safe, unguessable ID shown to users as a support reference. */
export function newRequestId(): string {
  return `req_${randomBytes(9).toString("base64url")}`;
}

/** Accept an upstream request ID (e.g. from the hosting platform) only if well-formed. */
export function requestIdFrom(headerValue: string | null | undefined): string {
  return headerValue && REQUEST_ID_PATTERN.test(headerValue) ? headerValue : newRequestId();
}
