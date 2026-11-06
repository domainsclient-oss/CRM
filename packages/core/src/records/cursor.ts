import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getServerEnv } from "../server-env";

// Signed pagination cursors (requirements/03 §9.1). The cursor names the query shape it was
// issued for, so it can't be replayed against a different filter/sort; the tenant is never
// in the cursor (it comes from the context). Tampering → treated as "first page".

type CursorValue =
  { t: "ts"; v: number } | { t: "s"; v: string } | { t: "n"; v: number } | { t: "null" };

interface CursorPayload {
  q: string;
  v: CursorValue;
  id: string;
}

let localSecret: string | undefined;

function secret(): string {
  const configured = getServerEnv().CURSOR_SIGNING_SECRET;
  if (configured) return configured;
  // Hosted environments require the secret (server-env); locally a per-process secret is fine
  // (cursors from before a restart just fall back to the first page).
  return (localSecret ??= randomBytes(32).toString("base64url"));
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

function encodeValue(value: unknown): CursorValue {
  if (value === null || value === undefined) return { t: "null" };
  if (value instanceof Timestamp) return { t: "ts", v: value.toMillis() };
  if (typeof value === "number") return { t: "n", v: value };
  return { t: "s", v: String(value) };
}

function decodeValue(value: CursorValue): unknown {
  switch (value.t) {
    case "null":
      return null;
    case "ts":
      return Timestamp.fromMillis(value.v);
    case "n":
    case "s":
      return value.v;
  }
}

export function encodeCursor(shapeId: string, sortValue: unknown, docId: string): string {
  const payload: CursorPayload = { q: shapeId, v: encodeValue(sortValue), id: docId };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Returns [sortValue, docId] for a valid cursor issued for this shape, else null. */
export function decodeCursor(shapeId: string, cursor: string | null): [unknown, string] | null {
  if (!cursor) return null;
  const [body, mac] = cursor.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CursorPayload;
    if (payload.q !== shapeId || typeof payload.id !== "string") return null;
    return [decodeValue(payload.v), payload.id];
  } catch {
    return null;
  }
}
