import "server-only";
import { Timestamp } from "firebase-admin/firestore";

// Firestore data → plain JSON for Server Components / Client Components: Timestamps become ISO
// strings. Internal fields (search tokens, normalized copies) are dropped.

const INTERNAL_FIELDS = new Set([
  "searchTokens",
  "nameLower",
  "fullNameLower",
  "emailNormalized",
  "domainNormalized",
  "relatedKeys",
  "schemaVersion",
  "tenantId",
]);

export type Plain<T> = T extends Timestamp
  ? string
  : T extends Array<infer U>
    ? Array<Plain<U>>
    : T extends object
      ? { [K in keyof T]: Plain<T[K]> }
      : T;

export function toPlain(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !INTERNAL_FIELDS.has(k))
        .map(([k, v]) => [k, toPlain(v)]),
    );
  }
  return value;
}

export function iso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}
