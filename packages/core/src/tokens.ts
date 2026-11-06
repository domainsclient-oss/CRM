import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Single-use secrets (invitations, later unsubscribe/handoff). 256 bits of entropy;
// only the SHA-256 hash is stored, so a database leak doesn't reveal usable links.

export function generateToken(): string {
  return randomBytes(32).toString("base64url"); // 43 chars
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Short, non-reversible fingerprint for rate-limit keys and session logs (no raw PII). */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value.toLowerCase(), "utf8").digest("base64url").slice(0, 22);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
