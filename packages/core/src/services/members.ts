import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { workspaceScope, type WorkspaceRole } from "@crm/shared/permissions";
import { audit, auditNow } from "../audit";
import { assertCanChangeRole, assertCanInviteRole, authorize } from "../authz";
import { assertSeatCapacity, getEffectiveConfig } from "../config/entitlements";
import type { TenantContext } from "../contexts/tenant-context";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { getDb } from "../firebase-admin";
import { queueMail } from "../mail";
import type { InvitationDoc, MemberDoc, TenantDoc } from "../model";
import { POLICIES, enforceRateLimit } from "../rate-limit";
import { OWNED_COLLECTIONS, assertSafeId, tenantCollection } from "../repositories/base";
import { assertRecentAuth, revokeAllSessions } from "../session";
import { notify } from "../notifications";
import { createInvitationInTx, rotateInvitationTokenInTx } from "./invitations";

// Team management (FR-RBAC-001/003/007, FR-AUTH-006, T-03-05). Every function takes a
// server-built TenantContext; target users/invitations are always loaded from this tenant.

const MAX_RESENDS = 3;

export interface MemberView {
  uid: string;
  displayName: string;
  email: string;
  role: WorkspaceRole;
}

export interface PendingInvitationView {
  id: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: string;
  resendCount: number;
}

export async function listTeam(ctx: TenantContext): Promise<{
  members: MemberView[];
  invitations: PendingInvitationView[];
}> {
  authorize(ctx, "member.read");
  const members = (
    await tenantCollection(ctx, "members").where("status", "==", "active").get()
  ).docs
    .map((d) => d.data() as MemberDoc)
    .map((m) => ({ uid: m.uid, displayName: m.displayName, email: m.email, role: m.role }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Pending invitations are visible only to those who can manage them.
  const invitations = workspaceScope(ctx.role, "member.invite")
    ? (await tenantCollection(ctx, "invitations").where("status", "==", "pending").get()).docs
        .map((d) => ({ id: d.id, data: d.data() as InvitationDoc }))
        .filter(
          ({ data }) => data.expiresAt.toMillis() > Date.now() && data.target.kind === "workspace",
        )
        .map(({ id, data }) => ({
          id,
          email: data.email,
          role: data.target.role as WorkspaceRole,
          expiresAt: data.expiresAt.toDate().toISOString(),
          resendCount: data.resendCount,
        }))
    : [];
  return { members, invitations };
}

async function loadMember(ctx: TenantContext, uid: string): Promise<MemberDoc> {
  assertSafeId(uid);
  const snap = await tenantCollection(ctx, "members").doc(uid).get();
  const member = snap.data() as MemberDoc | undefined;
  if (!member || member.status !== "active") throw new NotFoundError("member_not_found");
  return member;
}

export async function inviteMember(
  ctx: TenantContext,
  input: { email: string; role: WorkspaceRole },
): Promise<{ invitationId: string }> {
  authorize(ctx, "member.invite");
  assertCanInviteRole(ctx, input.role);
  await enforceRateLimit(POLICIES.invitationCreateByTenant, ctx.tenantId);
  const email = input.email.toLowerCase();

  return getDb().runTransaction(async (tx) => {
    const existingMember = await tx.get(
      tenantCollection(ctx, "members")
        .where("email", "==", email)
        .where("status", "==", "active")
        .limit(1),
    );
    if (!existingMember.empty) throw new ConflictError("already_member");
    const pending = await tx.get(
      tenantCollection(ctx, "invitations")
        .where("email", "==", email)
        .where("status", "==", "pending"),
    );
    if (pending.docs.some((d) => (d.data() as InvitationDoc).expiresAt.toMillis() > Date.now())) {
      throw new ConflictError("invitation_pending");
    }
    // Seats in use = active members + outstanding invitations (FR-PLAN-001).
    const [usage, outstanding] = await Promise.all([
      tx.get(tenantCollection(ctx, "usage").doc("current")),
      tx.get(tenantCollection(ctx, "invitations").where("status", "==", "pending").count()),
    ]);
    assertSeatCapacity(
      await getEffectiveConfig(ctx),
      ((usage.get("seats") as number | undefined) ?? 0) + outstanding.data().count,
    );
    const { invitationId } = createInvitationInTx(tx, {
      target: { kind: "workspace", tenantId: ctx.tenantId, role: input.role },
      email,
      invitedBy: ctx.uid,
      host: ctx.tenant.canonicalHost,
      requestId: ctx.requestId,
      displayName: ctx.tenant.name,
    });
    return { invitationId };
  });
}

export async function revokeInvitation(ctx: TenantContext, invitationId: string): Promise<void> {
  authorize(ctx, "member.invite");
  assertSafeId(invitationId);
  await getDb().runTransaction(async (tx) => {
    const ref = tenantCollection(ctx, "invitations").doc(invitationId);
    const invitation = (await tx.get(ref)).data() as
      (InvitationDoc & { tokenHash: string }) | undefined;
    if (!invitation || invitation.status !== "pending")
      throw new NotFoundError("invitation_not_found");
    tx.update(ref, {
      status: "revoked",
      revokedBy: ctx.uid,
      revokedAt: FieldValue.serverTimestamp(),
    });
    tx.delete(getDb().doc(`invitationTokens/${invitation.tokenHash}`));
    audit(
      tx,
      { tenantId: ctx.tenantId },
      {
        action: "invitation.revoked",
        actor: { type: "user", uid: ctx.uid },
        target: { type: "invitation", id: invitationId },
        requestId: ctx.requestId,
      },
    );
  });
}

export async function resendInvitation(ctx: TenantContext, invitationId: string): Promise<void> {
  authorize(ctx, "member.invite");
  assertSafeId(invitationId);
  await enforceRateLimit(POLICIES.invitationCreateByTenant, ctx.tenantId);
  await getDb().runTransaction(async (tx) => {
    const ref = tenantCollection(ctx, "invitations").doc(invitationId);
    const invitation = (await tx.get(ref)).data() as
      (InvitationDoc & { tokenHash: string }) | undefined;
    if (!invitation || invitation.status !== "pending")
      throw new NotFoundError("invitation_not_found");
    if (invitation.resendCount >= MAX_RESENDS) throw new AppError("RATE_LIMITED", "resend_limit");
    rotateInvitationTokenInTx(tx, ref, invitation, {
      requestId: ctx.requestId,
      actorUid: ctx.uid,
      displayName: ctx.tenant.name,
    });
  });
}

export async function changeRole(
  ctx: TenantContext,
  input: { uid: string; role: WorkspaceRole },
): Promise<void> {
  authorize(ctx, "member.update");
  const target = await loadMember(ctx, input.uid);
  assertCanChangeRole(ctx, target, input.role);
  // FR-AUTH-004 AC5: granting admin requires a recent sign-in.
  if (input.role === "admin") assertRecentAuth(ctx.session);

  await getDb().runTransaction(async (tx) => {
    const ref = tenantCollection(ctx, "members").doc(input.uid);
    const fresh = (await tx.get(ref)).data() as MemberDoc | undefined;
    if (!fresh || fresh.status !== "active" || fresh.role !== target.role) {
      throw new ConflictError("member_changed");
    }
    tx.update(ref, { role: input.role, updatedAt: FieldValue.serverTimestamp() });
    audit(
      tx,
      { tenantId: ctx.tenantId },
      {
        action: "member.role_changed",
        actor: { type: "user", uid: ctx.uid },
        target: { type: "member", id: input.uid },
        meta: { from: target.role, to: input.role },
        requestId: ctx.requestId,
      },
    );
  });
  await notify({
    tenantId: ctx.tenantId,
    recipientUid: input.uid,
    type: "role_changed",
    title: input.role,
    link: "/",
  });
}

const BATCH_LIMIT = 400;

/** Move every record owned by `fromUid` to `toUid` (idempotent; safe to retry). */
async function reassignRecords(
  ctx: TenantContext,
  fromUid: string,
  toUid: string,
): Promise<number> {
  let moved = 0;
  for (const [collection, field] of Object.entries(OWNED_COLLECTIONS)) {
    for (;;) {
      const snap = await tenantCollection(ctx, collection as keyof typeof OWNED_COLLECTIONS)
        .where(field, "==", fromUid)
        .limit(BATCH_LIMIT)
        .get();
      if (snap.empty) break;
      const batch = getDb().batch();
      for (const doc of snap.docs) {
        batch.update(doc.ref, {
          [field]: toUid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: ctx.uid,
        });
      }
      await batch.commit();
      moved += snap.size;
    }
  }
  return moved;
}

const CAN_OWN_RECORDS: WorkspaceRole[] = ["owner", "admin", "manager", "member"];

/**
 * Remove a member (FR-RBAC-003 AC3): their records are reassigned first, access ends on
 * the next request, and they're signed out everywhere if they belong nowhere else.
 */
export async function removeMember(
  ctx: TenantContext,
  input: { uid: string; reassignTo: string },
): Promise<{ recordsReassigned: number }> {
  authorize(ctx, "member.remove");
  if (input.uid === ctx.uid) throw new ForbiddenError("cannot_remove_self");
  if (input.reassignTo === input.uid)
    throw new AppError("VALIDATION", "reassign_to_self", {
      reassignTo: ["Choose someone else"],
    });
  const target = await loadMember(ctx, input.uid);
  if (target.role === "owner") throw new ForbiddenError("owner_immutable");
  if (ctx.role === "admin" && target.role === "admin") throw new ForbiddenError("admin_scope");
  const heir = await loadMember(ctx, input.reassignTo);
  if (!CAN_OWN_RECORDS.includes(heir.role)) {
    throw new AppError("VALIDATION", "heir_cannot_own", {
      reassignTo: ["This person can't own records"],
    });
  }

  const recordsReassigned = await reassignRecords(ctx, input.uid, input.reassignTo);

  const remaining = await getDb().runTransaction(async (tx) => {
    const memberRef = tenantCollection(ctx, "members").doc(input.uid);
    const userRef = getDb().doc(`users/${input.uid}`);
    const [memberSnap, userSnap] = await Promise.all([tx.get(memberRef), tx.get(userRef)]);
    if (!memberSnap.exists) throw new NotFoundError("member_not_found");
    tx.delete(memberRef);
    tx.set(userRef, { tenantIds: FieldValue.arrayRemove(ctx.tenantId) }, { merge: true });
    tx.set(
      tenantCollection(ctx, "usage").doc("current"),
      { seats: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.update(getDb().doc(`agencies/${ctx.agencyId}`), { "usage.seats": FieldValue.increment(-1) });
    audit(
      tx,
      { tenantId: ctx.tenantId },
      {
        action: "member.removed",
        actor: { type: "user", uid: ctx.uid },
        target: { type: "member", id: input.uid },
        meta: { role: target.role, recordsReassigned, reassignedTo: input.reassignTo },
        requestId: ctx.requestId,
      },
    );
    const tenantIds = ((userSnap.get("tenantIds") as string[] | undefined) ?? []).filter(
      (id) => id !== ctx.tenantId,
    );
    const agencyIds = (userSnap.get("agencyIds") as string[] | undefined) ?? [];
    return tenantIds.length + agencyIds.length;
  });

  const isPlatformAdmin = (await getDb().doc(`platformAdmins/${input.uid}`).get()).exists;
  if (remaining === 0 && !isPlatformAdmin) await revokeAllSessions(input.uid);
  return { recordsReassigned };
}

/** FR-AUTH-006 AC2: revoke a member's sessions everywhere. Admins can't target owners/admins. */
export async function forceSignOut(ctx: TenantContext, uid: string): Promise<void> {
  authorize(ctx, "member.forceSignOut");
  if (uid === ctx.uid) throw new ForbiddenError("use_sign_out");
  const target = await loadMember(ctx, uid);
  if (target.role === "owner" || (ctx.role === "admin" && target.role === "admin")) {
    throw new ForbiddenError("target_not_allowed");
  }
  await revokeAllSessions(uid);
  await auditNow(
    { tenantId: ctx.tenantId },
    {
      action: "member.signed_out",
      actor: { type: "user", uid: ctx.uid },
      target: { type: "member", id: uid },
      requestId: ctx.requestId,
    },
  );
}

/** FR-RBAC-007: Owner → active Admin; previous owner becomes Admin. Re-auth required. */
export async function transferOwnership(ctx: TenantContext, toUid: string): Promise<void> {
  authorize(ctx, "tenant.transferOwnership");
  assertRecentAuth(ctx.session);
  if (toUid === ctx.uid)
    throw new AppError("VALIDATION", "self_transfer", { toUid: ["Choose an admin"] });
  assertSafeId(toUid);

  await getDb().runTransaction(async (tx) => {
    const members = tenantCollection(ctx, "members");
    const tenantRef = getDb().doc(`tenants/${ctx.tenantId}`);
    const [fromSnap, toSnap, tenantSnap] = await Promise.all([
      tx.get(members.doc(ctx.uid)),
      tx.get(members.doc(toUid)),
      tx.get(tenantRef),
    ]);
    const from = fromSnap.data() as MemberDoc | undefined;
    const to = toSnap.data() as MemberDoc | undefined;
    const tenant = tenantSnap.data() as TenantDoc | undefined;
    if (!from || from.role !== "owner" || tenant?.ownerUid !== ctx.uid)
      throw new ConflictError("not_owner");
    if (!to || to.status !== "active") throw new NotFoundError("member_not_found");
    if (to.role !== "admin")
      throw new AppError("VALIDATION", "target_must_be_admin", { toUid: ["Must be an admin"] });

    tx.update(members.doc(ctx.uid), { role: "admin", updatedAt: FieldValue.serverTimestamp() });
    tx.update(members.doc(toUid), { role: "owner", updatedAt: FieldValue.serverTimestamp() });
    tx.update(tenantRef, { ownerUid: toUid, ownerChangedAt: Timestamp.now() });
    for (const person of [from, to]) {
      queueMail(tx, {
        template: "ownership_transferred",
        to: person.email,
        variables: { workspace: tenant.name },
        tenantId: ctx.tenantId,
      });
    }
    audit(
      tx,
      { tenantId: ctx.tenantId },
      {
        action: "tenant.ownership_transferred",
        actor: { type: "user", uid: ctx.uid },
        target: { type: "member", id: toUid },
        requestId: ctx.requestId,
      },
    );
  });
}
