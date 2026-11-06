import "server-only";
import {
  FieldValue,
  Timestamp,
  type DocumentReference,
  type Transaction,
} from "firebase-admin/firestore";
import { normalizeHost } from "@crm/shared/hosts";
import type { AgencyRole, WorkspaceRole } from "@crm/shared/permissions";
import { audit } from "../audit";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { getAdminAuth, getDb } from "../firebase-admin";
import { queueMail } from "../mail";
import type { AgencyDoc, InvitationDoc, InvitationTarget, TenantDoc } from "../model";
import { verifyFreshIdToken } from "../session";
import { generateToken, hashToken } from "../tokens";
import { hostUrl } from "../urls";
import { notify } from "../notifications";
import { assertSeatCapacity, resolveEffectiveConfig } from "../config/entitlements";

// Invitations (FR-RBAC-001, FR-AUTH-001, FR-AGY-001). The ONLY way accounts are created:
// a 256-bit single-use token, stored hashed, valid 7 days, accepted only on its own host.

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function invitationCollection(target: InvitationTarget): string {
  return target.kind === "workspace"
    ? `tenants/${target.tenantId}/invitations`
    : `agencies/${target.agencyId}/invitations`;
}

/** Create an invitation inside the caller's transaction and queue the email. Returns the raw token. */
export function createInvitationInTx(
  tx: Transaction,
  input: {
    target: InvitationTarget;
    email: string;
    invitedBy: string;
    host: string;
    requestId: string;
    displayName: string;
  },
): { invitationId: string; token: string } {
  const host = normalizeHost(input.host);
  if (!host) throw new Error("invalid invitation host");
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = Timestamp.fromMillis(Date.now() + INVITE_TTL_MS);
  const ref = getDb().collection(invitationCollection(input.target)).doc();
  const email = input.email.toLowerCase();

  const invitation: InvitationDoc = {
    email,
    target: input.target,
    status: "pending",
    invitedBy: input.invitedBy,
    host,
    expiresAt,
    resendCount: 0,
  };
  tx.create(ref, {
    ...invitation,
    tokenHash,
    createdAt: FieldValue.serverTimestamp(),
    // TTL cleanup a month after expiry (requirements/03 §13)
    expireAt: Timestamp.fromMillis(expiresAt.toMillis() + 30 * 24 * 60 * 60 * 1000),
  });
  tx.create(getDb().doc(`invitationTokens/${tokenHash}`), {
    path: ref.path,
    // TTL cleanup a month after expiry (requirements/03 §13)
    expireAt: Timestamp.fromMillis(expiresAt.toMillis() + 30 * 24 * 60 * 60 * 1000),
  });
  queueMail(tx, {
    template: input.target.kind === "workspace" ? "workspace_invitation" : "agency_invitation",
    to: email,
    variables: { link: hostUrl(host, `/invite/${token}`), name: input.displayName },
    ...(input.target.kind === "workspace"
      ? { tenantId: input.target.tenantId }
      : { agencyId: input.target.agencyId }),
  });
  const scope =
    input.target.kind === "workspace"
      ? { tenantId: input.target.tenantId }
      : { agencyId: input.target.agencyId };
  audit(tx, scope, {
    action: "invitation.created",
    actor: { type: "user", uid: input.invitedBy },
    target: { type: "invitation", id: ref.id },
    meta: { role: input.target.role },
    requestId: input.requestId,
  });
  return { invitationId: ref.id, token };
}

/**
 * Re-send: issue a fresh token (old link stops working), reset expiry, queue the email.
 * Caller has already read `invitation` in this transaction.
 */
export function rotateInvitationTokenInTx(
  tx: Transaction,
  ref: DocumentReference,
  invitation: InvitationDoc & { tokenHash: string },
  input: { requestId: string; actorUid: string; displayName: string },
): void {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = Timestamp.fromMillis(Date.now() + INVITE_TTL_MS);
  const expireAt = Timestamp.fromMillis(expiresAt.toMillis() + 30 * 24 * 60 * 60 * 1000);
  tx.delete(getDb().doc(`invitationTokens/${invitation.tokenHash}`));
  tx.create(getDb().doc(`invitationTokens/${tokenHash}`), { path: ref.path, expireAt });
  tx.update(ref, {
    tokenHash,
    expiresAt,
    expireAt,
    resendCount: FieldValue.increment(1),
  });
  const target = invitation.target;
  queueMail(tx, {
    template: target.kind === "workspace" ? "workspace_invitation" : "agency_invitation",
    to: invitation.email,
    variables: { link: hostUrl(invitation.host, `/invite/${token}`), name: input.displayName },
    ...(target.kind === "workspace"
      ? { tenantId: target.tenantId }
      : { agencyId: target.agencyId }),
  });
  const scope =
    target.kind === "workspace" ? { tenantId: target.tenantId } : { agencyId: target.agencyId };
  audit(tx, scope, {
    action: "invitation.resent",
    actor: { type: "user", uid: input.actorUid },
    target: { type: "invitation", id: ref.id },
    requestId: input.requestId,
  });
}

export interface InvitationView {
  email: string;
  kind: InvitationTarget["kind"];
  role: WorkspaceRole | AgencyRole;
  /** Whether an account already exists for this email (decides the accept form). */
  accountExists: boolean;
}

async function loadPending(token: string, host: string) {
  const normalized = normalizeHost(host);
  const pointer = await getDb()
    .doc(`invitationTokens/${hashToken(token)}`)
    .get();
  const path = pointer.get("path") as string | undefined;
  if (!normalized || !path) throw new NotFoundError("invitation_not_found");
  const snap = await getDb().doc(path).get();
  const invitation = snap.data() as InvitationDoc | undefined;
  // Expired, revoked, used, or foreign-host invitations all look the same to the caller.
  if (
    !invitation ||
    invitation.status !== "pending" ||
    invitation.expiresAt.toMillis() <= Date.now() ||
    invitation.host !== normalized
  ) {
    throw new NotFoundError("invitation_unavailable");
  }
  return { ref: snap.ref, invitation };
}

/** Public lookup for the accept page (shown only on the invitation's own host). */
export async function viewInvitation(token: string, host: string): Promise<InvitationView> {
  const { invitation } = await loadPending(token, host);
  const accountExists = await getAdminAuth()
    .getUserByEmail(invitation.email)
    .then(() => true)
    .catch(() => false);
  return {
    email: invitation.email,
    kind: invitation.target.kind,
    role: invitation.target.role,
    accountExists,
  };
}

export type AcceptInput =
  | { token: string; newAccount: { displayName: string; password: string } }
  | { token: string; idToken: string };

/**
 * Accept an invitation. New users get an account created server-side (emailVerified:
 * the invitation link proves mailbox control). Existing users prove identity with a
 * fresh ID token whose email matches the invitation.
 */
export async function acceptInvitation(
  input: AcceptInput,
  req: { host: string; requestId: string },
): Promise<{ uid: string; kind: InvitationTarget["kind"] }> {
  const { invitation } = await loadPending(input.token, req.host);
  const auth = getAdminAuth();

  let uid: string;
  let displayName: string;
  let createdUid: string | null = null;
  if ("newAccount" in input) {
    const existing = await auth.getUserByEmail(invitation.email).catch(() => null);
    if (existing) throw new ConflictError("account_exists_sign_in_instead");
    const user = await auth.createUser({
      email: invitation.email,
      password: input.newAccount.password,
      displayName: input.newAccount.displayName,
      emailVerified: true,
    });
    uid = createdUid = user.uid;
    displayName = input.newAccount.displayName;
  } else {
    const session = await verifyFreshIdToken(input.idToken);
    if (session.email !== invitation.email) throw new ForbiddenError("invitation_email_mismatch");
    uid = session.uid;
    displayName = (await auth.getUser(uid)).displayName ?? invitation.email;
  }

  try {
    await getDb().runTransaction((tx) => acceptInTx(tx, input.token, req, uid, displayName));
  } catch (error) {
    // Never leave an account behind without a membership.
    if (createdUid) await auth.deleteUser(createdUid).catch(() => undefined);
    throw error;
  }
  if (invitation.target.kind === "workspace") {
    await notify({
      tenantId: invitation.target.tenantId,
      recipientUid: invitation.invitedBy,
      type: "invitation_accepted",
      title: displayName,
      link: "/settings/members",
    });
  }
  return { uid, kind: invitation.target.kind };
}

async function acceptInTx(
  tx: Transaction,
  token: string,
  req: { host: string; requestId: string },
  uid: string,
  displayName: string,
): Promise<void> {
  const db = getDb();
  const pointerRef = db.doc(`invitationTokens/${hashToken(token)}`);
  const pointer = await tx.get(pointerRef);
  const path = pointer.get("path") as string | undefined;
  if (!path) throw new NotFoundError("invitation_not_found");
  const invRef = db.doc(path);
  const invSnap = await tx.get(invRef);
  const invitation = invSnap.data() as InvitationDoc | undefined;
  if (
    !invitation ||
    invitation.status !== "pending" ||
    invitation.expiresAt.toMillis() <= Date.now() ||
    invitation.host !== normalizeHost(req.host)
  ) {
    throw new NotFoundError("invitation_unavailable");
  }
  const target = invitation.target;
  const userRef = db.doc(`users/${uid}`);

  if (target.kind === "workspace") {
    const tenantRef = db.doc(`tenants/${target.tenantId}`);
    const memberRef = db.doc(`tenants/${target.tenantId}/members/${uid}`);
    const [tenantSnap, memberSnap] = await Promise.all([tx.get(tenantRef), tx.get(memberRef)]);
    const tenant = tenantSnap.data() as TenantDoc | undefined;
    if (!tenant || tenant.status !== "active")
      throw new AppError("TENANT_SUSPENDED", "tenant_inactive");
    const agencyRef = db.doc(`agencies/${tenant.agencyId}`);
    const agency = (await tx.get(agencyRef)).data() as AgencyDoc | undefined;
    if (!agency || agency.status !== "active")
      throw new AppError("TENANT_SUSPENDED", "agency_inactive");
    if (memberSnap.exists && memberSnap.get("status") === "active")
      throw new ConflictError("already_member");
    if ((agency.usage?.seats ?? 0) >= agency.quotas.maxSeatsTotal) {
      throw new AppError("PLAN_LIMIT_EXCEEDED", "agency_seat_quota");
    }
    const usage = await tx.get(db.doc(`tenants/${target.tenantId}/usage/current`));
    assertSeatCapacity(
      resolveEffectiveConfig(tenant, agency),
      (usage.get("seats") as number | undefined) ?? 0,
    );

    tx.set(memberRef, {
      uid,
      tenantId: target.tenantId,
      email: invitation.email,
      displayName,
      role: target.role,
      status: "active",
      invitedBy: invitation.invitedBy,
      joinedAt: FieldValue.serverTimestamp(),
    });
    if (target.role === "owner") tx.update(tenantRef, { ownerUid: uid });
    tx.set(
      db.doc(`tenants/${target.tenantId}/usage/current`),
      { seats: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.update(agencyRef, { "usage.seats": FieldValue.increment(1) });
    tx.set(
      userRef,
      { email: invitation.email, displayName, tenantIds: FieldValue.arrayUnion(target.tenantId) },
      { merge: true },
    );
    audit(
      tx,
      { tenantId: target.tenantId },
      {
        action: "member.joined",
        actor: { type: "user", uid },
        target: { type: "member", id: uid },
        meta: { role: target.role },
        requestId: req.requestId,
      },
    );
  } else {
    const agencyRef = db.doc(`agencies/${target.agencyId}`);
    const staffRef = db.doc(`agencies/${target.agencyId}/staff/${uid}`);
    const [agencySnap, staffSnap] = await Promise.all([tx.get(agencyRef), tx.get(staffRef)]);
    const agency = agencySnap.data() as AgencyDoc | undefined;
    if (!agency || agency.status !== "active")
      throw new AppError("TENANT_SUSPENDED", "agency_inactive");
    if (staffSnap.exists && staffSnap.get("status") === "active")
      throw new ConflictError("already_staff");

    tx.set(staffRef, {
      uid,
      agencyId: target.agencyId,
      email: invitation.email,
      displayName,
      role: target.role,
      status: "active",
      joinedAt: FieldValue.serverTimestamp(),
    });
    if (target.role === "agency_owner") tx.update(agencyRef, { ownerUid: uid });
    tx.set(
      userRef,
      { email: invitation.email, displayName, agencyIds: FieldValue.arrayUnion(target.agencyId) },
      { merge: true },
    );
    audit(
      tx,
      { agencyId: target.agencyId },
      {
        action: "staff.joined",
        actor: { type: "agency_staff", uid },
        target: { type: "staff", id: uid },
        meta: { role: target.role },
        requestId: req.requestId,
      },
    );
  }

  tx.update(invRef, {
    status: "accepted",
    acceptedBy: uid,
    acceptedAt: FieldValue.serverTimestamp(),
  });
  tx.delete(pointerRef); // single use
}
