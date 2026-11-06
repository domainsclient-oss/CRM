import "server-only";
import { isPlatformRole, type PlatformRole } from "@crm/shared/permissions";
import { ForbiddenError, UnauthenticatedError } from "../errors";
import { getDb } from "../firebase-admin";
import { logger, type Logger } from "../logger";
import type { PlatformAdminDoc } from "../model";
import { getServerEnv } from "../server-env";
import { verifySession, type Session } from "../session";

// Platform console context (console host). FR-AUTH-008: platform staff sign in with
// Google only, from an allowlisted Workspace domain (2-Step Verification is enforced
// by the operator's Google Workspace policy while MFA is deferred).

export interface PlatformContext {
  uid: string;
  role: PlatformRole;
  session: Session;
  requestId: string;
  log: Logger;
}

export function allowedStaffDomains(): string[] {
  return (getServerEnv().APP_PLATFORM_STAFF_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/** Pure check, exported for tests. */
export function isAllowedPlatformIdentity(session: Session, domains: string[]): boolean {
  if (session.signInProvider !== "google.com" || !session.emailVerified || !session.email)
    return false;
  const domain = session.email.split("@")[1];
  return domain !== undefined && domains.includes(domain);
}

export async function loadPlatformAdmin(session: Session): Promise<PlatformAdminDoc> {
  if (!isAllowedPlatformIdentity(session, allowedStaffDomains())) {
    throw new ForbiddenError("platform_identity_not_allowed");
  }
  const snap = await getDb().doc(`platformAdmins/${session.uid}`).get();
  const admin = snap.data() as PlatformAdminDoc | undefined;
  if (!admin || !isPlatformRole(admin.role)) throw new ForbiddenError("not_platform_admin");
  return admin;
}

export async function requirePlatformContext(input: {
  /** Request host; the session cookie must have been issued for it. */
  host: string;
  sessionCookie: string | undefined;
  requestId: string;
}): Promise<PlatformContext> {
  const session = await verifySession(input.sessionCookie, { kind: "console", host: input.host });
  if (!session) throw new UnauthenticatedError();
  const admin = await loadPlatformAdmin(session);
  return {
    uid: session.uid,
    role: admin.role,
    session,
    requestId: input.requestId,
    log: logger.child({ requestId: input.requestId, uid: session.uid, context: "platform" }),
  };
}
