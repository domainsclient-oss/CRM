import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeHost } from "@crm/shared/hosts";
import { getAdminAuth } from "./firebase-admin";
import { AppError, UnauthenticatedError } from "./errors";
import { getServerEnv } from "./server-env";

// Server sessions (requirements/02 §4, 04 §4; FR-AUTH-004/006/008).
// The browser signs in with Firebase Auth, then trades a fresh ID token for an
// httpOnly session cookie. Authorization uses only this cookie.
//
// Binding (T-09-01 finding F-03): a Firebase session cookie by itself is valid anywhere in the
// project. Each cookie we issue carries an HMAC over (surface, host, cookie), so a cookie minted
// for one workspace host can't be replayed on another host or on the consoles — e.g. one
// captured by whoever controls a custom domain's DNS.

export type SessionKind = "workspace" | "console" | "partners";

/** Where a session cookie may be used: the surface and the exact host it was issued on. */
export interface SessionBinding {
  kind: SessionKind;
  host: string;
}

const LOCAL_BINDING_SECRET = "local-only-session-binding-secret-not-for-hosted-envs";

function bindingMac(raw: string, binding: SessionBinding): string {
  const secret = getServerEnv().SESSION_BINDING_SECRET ?? LOCAL_BINDING_SECRET;
  const host = normalizeHost(binding.host) ?? binding.host;
  return createHmac("sha256", secret).update(`${binding.kind}|${host}|${raw}`).digest("base64url");
}

/** Cookie value = Firebase session cookie + "~" + binding MAC. */
function bind(raw: string, binding: SessionBinding): string {
  return `${raw}~${bindingMac(raw, binding)}`;
}

/** The Firebase cookie inside a bound value, or null if the MAC doesn't match this binding. */
function unbind(value: string, binding: SessionBinding): string | null {
  const at = value.lastIndexOf("~");
  if (at <= 0) return null;
  const raw = value.slice(0, at);
  const given = Buffer.from(value.slice(at + 1));
  const expected = Buffer.from(bindingMac(raw, binding));
  return given.length === expected.length && timingSafeEqual(given, expected) ? raw : null;
}

export interface Session {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  /** Seconds since epoch of the last real sign-in (used for re-auth checks). */
  authTime: number;
  signInProvider: string | null;
}

const MAX_SIGN_IN_AGE_SECONDS = 5 * 60;
const HOUR_MS = 60 * 60 * 1000;

/** Cookie name and lifetime per host class. `__Host-` requires HTTPS, so local dev uses plain names. */
export function sessionPolicy(kind: SessionKind, secure: boolean) {
  const env = getServerEnv();
  const base = { workspace: "session", console: "console", partners: "partners" }[kind];
  const maxAgeMs = {
    workspace: env.APP_SESSION_MAX_AGE_DAYS * 24 * HOUR_MS,
    console: 8 * HOUR_MS,
    partners: 12 * HOUR_MS,
  }[kind];
  return { cookieName: secure ? `__Host-${base}` : base, maxAgeMs };
}

/**
 * Exchange a fresh ID token for a session cookie value.
 * Prefer verifyFreshIdToken → authorize → mintSessionCookie so no cookie is ever created
 * for a user who isn't allowed in (services/auth.ts does this).
 */
export async function createSessionCookie(
  idToken: string,
  binding: SessionBinding,
  secure: boolean,
) {
  const session = await verifyFreshIdToken(idToken);
  return { ...(await mintSessionCookie(idToken, binding, secure)), session };
}

/** Verify an ID token from a just-completed sign-in: valid, not revoked, verified email, fresh. */
export async function verifyFreshIdToken(idToken: string): Promise<Session> {
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken, true);
  } catch {
    throw new UnauthenticatedError("invalid_id_token");
  }
  if (!decoded.email_verified) throw new AppError("FORBIDDEN", "email_not_verified");
  const ageSeconds = Math.floor(Date.now() / 1000) - decoded.auth_time;
  if (ageSeconds > MAX_SIGN_IN_AGE_SECONDS) throw new AppError("REAUTH_REQUIRED", "stale_sign_in");
  return toSession(decoded);
}

/** Mint the cookie. Call only after the user has been authorized for this host. */
export async function mintSessionCookie(idToken: string, binding: SessionBinding, secure: boolean) {
  const { cookieName, maxAgeMs } = sessionPolicy(binding.kind, secure);
  const raw = await getAdminAuth().createSessionCookie(idToken, { expiresIn: maxAgeMs });
  return { cookie: bind(raw, binding), cookieName, maxAgeSeconds: Math.floor(maxAgeMs / 1000) };
}

/**
 * Verify a session cookie for this surface and host, including revocation and disabled-user
 * checks. Cookies issued for another host or surface (or unbound ones) are rejected.
 */
export async function verifySession(
  cookie: string | undefined | null,
  binding: SessionBinding,
): Promise<Session | null> {
  if (!cookie) return null;
  const raw = unbind(cookie, binding);
  if (!raw) return null;
  try {
    return toSession(await getAdminAuth().verifySessionCookie(raw, true));
  } catch {
    return null;
  }
}

/** Sign the user out everywhere (FR-AUTH-006). */
export async function revokeAllSessions(uid: string): Promise<void> {
  await getAdminAuth().revokeRefreshTokens(uid);
}

/** Sensitive operations require a sign-in within the re-auth window (FR-AUTH-004 AC5, FR-AUTH-008). */
export function assertRecentAuth(session: Session, nowMs = Date.now()): void {
  const windowSeconds = getServerEnv().APP_REAUTH_WINDOW_SECONDS;
  if (Math.floor(nowMs / 1000) - session.authTime > windowSeconds) {
    throw new AppError("REAUTH_REQUIRED", "reauth_required");
  }
}

function toSession(claims: {
  uid: string;
  email?: string | undefined;
  email_verified?: boolean | undefined;
  auth_time: number;
  firebase: { sign_in_provider?: string | undefined };
}): Session {
  return {
    uid: claims.uid,
    email: claims.email?.toLowerCase() ?? null,
    emailVerified: claims.email_verified === true,
    authTime: claims.auth_time,
    signInProvider: claims.firebase.sign_in_provider ?? null,
  };
}
