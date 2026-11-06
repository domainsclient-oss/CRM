import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { normalizeHost } from "@crm/shared/hosts";
import { auditNow } from "../audit";
import { listStaffAgencies } from "../contexts/agency-context";
import { loadPlatformAdmin } from "../contexts/platform-context";
import {
  loadActiveWorkspace,
  loadMembership,
  resolveWorkspaceByHost,
} from "../contexts/tenant-context";
import { AppError, ForbiddenError, NotFoundError } from "../errors";
import { getAdminAuth, getDb } from "../firebase-admin";
import { logger } from "../logger";
import { queueMailNow } from "../mail";
import type { StaffDoc } from "../model";
import {
  mintSessionCookie,
  revokeAllSessions,
  verifyFreshIdToken,
  verifySession,
  type Session,
  type SessionBinding,
} from "../session";
import { fingerprint, generateToken, hashToken } from "../tokens";
import { hostUrl } from "../urls";

// Session start/end and privileged-account protections (FR-AUTH-004/006/008, T-02-02/10).
// Order matters: verify identity → authorize for this host → only then mint a cookie.

export interface ClientInfo {
  host: string;
  secure: boolean;
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

export async function startWorkspaceSession(idToken: string, client: ClientInfo) {
  const ref = await resolveWorkspaceByHost(client.host);
  if (!ref) throw new NotFoundError("unknown_host");
  const session = await verifyFreshIdToken(idToken);
  const tenant = await loadActiveWorkspace(ref, { allowPendingDeletion: true });
  const member = await loadMembership(ref.tenantId, session.uid);
  if (!member) throw new ForbiddenError("no_membership");
  if (tenant.status === "pending_deletion" && member.role !== "owner") {
    throw new AppError("TENANT_SUSPENDED", "pending_deletion");
  }

  const minted = await mintSessionCookie(
    idToken,
    { kind: "workspace", host: client.host },
    client.secure,
  );
  // Last sign-in per workspace (agency "active users" metric, FR-AGY-006). Not PII.
  await getDb()
    .doc(`tenants/${ref.tenantId}/members/${session.uid}`)
    .update({ lastSeenAt: FieldValue.serverTimestamp() })
    .catch(() => undefined);
  await auditNow(
    { tenantId: ref.tenantId },
    {
      action: "auth.session_created",
      actor: { type: "user", uid: session.uid },
      target: { type: "session", id: session.uid },
      requestId: client.requestId,
      ip: client.ip,
      userAgent: client.userAgent,
    },
  );
  return minted;
}

/** Platform console: Google + allowlisted domain + platformAdmins record (FR-AUTH-008). */
export async function startConsoleSession(idToken: string, client: ClientInfo) {
  const session = await verifyFreshIdToken(idToken);
  await loadPlatformAdmin(session);
  const minted = await mintSessionCookie(
    idToken,
    { kind: "console", host: client.host },
    client.secure,
  );
  await recordPrivilegedLogin(session, "platform", client);
  return minted;
}

/** Agency console: an active staff record in an active agency. */
export async function startPartnersSession(idToken: string, client: ClientInfo) {
  const session = await verifyFreshIdToken(idToken);
  const agencyIds = await listStaffAgencies(session.uid);
  const staff = await Promise.all(
    agencyIds.map((id) => getDb().doc(`agencies/${id}/staff/${session.uid}`).get()),
  );
  if (!staff.some((s) => (s.data() as StaffDoc | undefined)?.status === "active")) {
    throw new ForbiddenError("no_agency_staff_record");
  }
  const minted = await mintSessionCookie(
    idToken,
    { kind: "partners", host: client.host },
    client.secure,
  );
  await recordPrivilegedLogin(session, "agency", client);
  return minted;
}

/** Sign out: revokes refresh tokens everywhere (FR-AUTH-006 AC1). Idempotent. */
export async function endSession(
  cookie: string | undefined,
  binding: SessionBinding,
  requestId: string,
): Promise<void> {
  const session = await verifySession(cookie, binding);
  if (!session) return;
  await revokeAllSessions(session.uid);
  logger.info("auth.session_revoked", { requestId, uid: session.uid });
}

const ALERT_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * FR-AUTH-008 AC4: log privileged sign-ins; on a new device (IP + user agent fingerprint),
 * email an alert with a single-use "this wasn't me" link that revokes all sessions.
 */
export async function recordPrivilegedLogin(
  session: Session,
  context: "platform" | "agency",
  client: ClientInfo,
): Promise<{ newDevice: boolean }> {
  const device = fingerprint(`${client.ip ?? "?"}|${client.userAgent ?? "?"}`);
  const db = getDb();
  const seen = await db
    .collection("privilegedSessions")
    .where("uid", "==", session.uid)
    .where("device", "==", device)
    .limit(1)
    .get();

  await db.collection("privilegedSessions").add({
    uid: session.uid,
    context,
    device,
    createdAt: FieldValue.serverTimestamp(),
    expireAt: Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60 * 1000),
  });
  await auditNow(
    { platform: true },
    {
      action: "auth.privileged_login",
      actor: { type: context === "platform" ? "platform_admin" : "agency_staff", uid: session.uid },
      target: { type: "session", id: session.uid },
      meta: { newDevice: seen.empty },
      requestId: client.requestId,
      ip: client.ip,
      userAgent: client.userAgent,
    },
  );

  if (seen.empty && session.email) {
    const token = generateToken();
    await db.doc(`revocationTokens/${hashToken(token)}`).create({
      uid: session.uid,
      expireAt: Timestamp.fromMillis(Date.now() + ALERT_LINK_TTL_MS),
    });
    const host = normalizeHost(client.host) ?? client.host;
    await queueMailNow({
      template: "privileged_login_alert",
      to: session.email,
      variables: { link: hostUrl(host, `/not-me?t=${token}`), context },
    });
  }
  return { newDevice: seen.empty };
}

/** "This wasn't me": single-use token → revoke all sessions for that user. */
export async function revokeWithAlertToken(token: string, requestId: string): Promise<boolean> {
  const db = getDb();
  const ref = db.doc(`revocationTokens/${hashToken(token)}`);
  const uid = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as { uid: string; expireAt: Timestamp } | undefined;
    if (!data || data.expireAt.toMillis() <= Date.now()) return null;
    tx.delete(ref);
    return data.uid;
  });
  if (!uid) return false;
  await revokeAllSessions(uid);
  await auditNow(
    { platform: true },
    {
      action: "auth.session_revoked",
      actor: { type: "user", uid },
      target: { type: "user", id: uid },
      meta: { reason: "not_me_link" },
      requestId,
    },
  );
  return true;
}

/**
 * Password reset (FR-AUTH-003): identical outcome whether or not the account exists
 * (no enumeration). The link returns the user to the host they asked from.
 */
export async function requestPasswordReset(email: string, client: ClientInfo): Promise<void> {
  const host = normalizeHost(client.host);
  if (!host) return;
  const exists = await getAdminAuth()
    .getUserByEmail(email)
    .then(() => true)
    .catch(() => false);
  if (!exists) return;
  const link = await getAdminAuth().generatePasswordResetLink(email, {
    url: hostUrl(host, "/login"),
  });
  // Branded with the workspace of the host the reset was requested from (FR-AUTH-003 AC2).
  const workspace = await resolveWorkspaceByHost(host);
  await queueMailNow({
    template: "password_reset",
    to: email,
    variables: { link },
    tenantId: workspace?.tenantId ?? null,
  });
}

/**
 * Accounts with no workspace membership, agency staff record, or platform role
 * (e.g. created directly via the Auth REST API). FR-AUTH-001 AC1a. Read-only.
 */
export async function findOrphanAccounts(olderThanDays = 7): Promise<string[]> {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const orphans: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await getAdminAuth().listUsers(1000, pageToken);
    for (const user of page.users) {
      if (Date.parse(user.metadata.creationTime) > cutoff) continue;
      const [userDoc, admin] = await Promise.all([
        getDb().doc(`users/${user.uid}`).get(),
        getDb().doc(`platformAdmins/${user.uid}`).get(),
      ]);
      const tenantIds = (userDoc.get("tenantIds") as string[] | undefined) ?? [];
      const agencyIds = (userDoc.get("agencyIds") as string[] | undefined) ?? [];
      if (!admin.exists && tenantIds.length === 0 && agencyIds.length === 0) orphans.push(user.uid);
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return orphans;
}
