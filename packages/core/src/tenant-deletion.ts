import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { audit } from "./audit";
import { authorize } from "./authz";
import type { TenantContext } from "./contexts/tenant-context";
import { clearTenantCaches } from "./contexts/tenant-context";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { getDb, getPrivateBucket } from "./firebase-admin";
import { logger } from "./logger";
import type { TenantDoc } from "./model";
import { assertSafeId } from "./repositories/base";
import { assertRecentAuth } from "./session";

// Tenant deletion (FR-TEN-006): Owner with a recent sign-in requests deletion by typing the slug →
// `pending_deletion` for 30 days (members blocked, Owner can cancel) → purge job deletes every
// document under the tenant, its storage objects and host mappings, quarantines the slug for
// 90 days, keeps a minimal tombstone, and verifies nothing is left.

const DAY = 24 * 60 * 60 * 1000;
export const DELETION_GRACE_DAYS = 30;
export const SLUG_QUARANTINE_DAYS = 90;

export async function requestTenantDeletion(ctx: TenantContext, confirmSlug: string) {
  authorize(ctx, "tenant.delete");
  assertRecentAuth(ctx.session);
  if (confirmSlug.trim().toLowerCase() !== ctx.tenant.slug) {
    throw new ValidationError({ confirmSlug: ["Type the workspace short name exactly"] });
  }
  const scheduled = Timestamp.fromMillis(Date.now() + DELETION_GRACE_DAYS * DAY);
  await getDb().runTransaction(async (tx) => {
    const ref = getDb().doc(`tenants/${ctx.tenantId}`);
    const tenant = (await tx.get(ref)).data() as TenantDoc | undefined;
    if (!tenant || tenant.status !== "active") throw new ConflictError("not_active");
    tx.update(ref, {
      status: "pending_deletion",
      deletionRequestedAt: FieldValue.serverTimestamp(),
      deletionRequestedBy: ctx.uid,
      deletionScheduledFor: scheduled,
    });
    const entry = {
      action: "tenant.deletion_requested" as const,
      actor: { type: "user" as const, uid: ctx.uid },
      target: { type: "tenant", id: ctx.tenantId },
      requestId: ctx.requestId,
    };
    audit(tx, { tenantId: ctx.tenantId }, entry);
    audit(tx, { agencyId: ctx.agencyId }, entry);
  });
  clearTenantCaches();
  return { scheduledFor: scheduled.toDate().toISOString() };
}

/** Owner cancels during the grace period (the shell offers only this while pending). */
export async function cancelTenantDeletion(ctx: TenantContext) {
  authorize(ctx, "tenant.delete");
  await getDb().runTransaction(async (tx) => {
    const ref = getDb().doc(`tenants/${ctx.tenantId}`);
    const tenant = (await tx.get(ref)).data() as TenantDoc | undefined;
    if (!tenant || tenant.status !== "pending_deletion") throw new ConflictError("not_pending");
    tx.update(ref, {
      status: "active",
      deletionRequestedAt: null,
      deletionRequestedBy: null,
      deletionScheduledFor: null,
    });
    const entry = {
      action: "tenant.deletion_cancelled" as const,
      actor: { type: "user" as const, uid: ctx.uid },
      target: { type: "tenant", id: ctx.tenantId },
      requestId: ctx.requestId,
    };
    audit(tx, { tenantId: ctx.tenantId }, entry);
    audit(tx, { agencyId: ctx.agencyId }, entry);
  });
  clearTenantCaches();
  return { ok: true };
}

/** Purge one tenant whose grace period has passed. Returns false if it isn't due. */
export async function purgeTenant(tenantId: string, now = new Date()): Promise<boolean> {
  assertSafeId(tenantId);
  const db = getDb();
  const ref = db.doc(`tenants/${tenantId}`);
  const tenant = (await ref.get()).data() as
    (TenantDoc & { deletionScheduledFor?: Timestamp; deletionRequestedBy?: string }) | undefined;
  if (!tenant) throw new NotFoundError();
  if (
    tenant.status !== "pending_deletion" ||
    !tenant.deletionScheduledFor ||
    tenant.deletionScheduledFor.toMillis() > now.getTime()
  ) {
    return false;
  }
  // Members' workspace lists.
  const members = await ref.collection("members").get();
  for (const m of members.docs) {
    await db
      .doc(`users/${m.id}`)
      .set({ tenantIds: FieldValue.arrayRemove(tenantId) }, { merge: true });
  }
  // Host mappings.
  const hosts = await db.collection("tenantDomains").where("tenantId", "==", tenantId).get();
  for (const h of hosts.docs) await h.ref.delete();
  // Storage objects (private files; brand assets are content-addressed and may be shared, but the
  // tenant prefix is removed too).
  await getPrivateBucket()
    .deleteFiles({ prefix: `imports/${tenantId}/` })
    .catch(() => undefined);
  await getPrivateBucket()
    .deleteFiles({ prefix: `exports/${tenantId}/` })
    .catch(() => undefined);
  // Every document under the tenant, then the tenant itself.
  await db.recursiveDelete(ref);
  const batch = db.batch();
  batch.set(db.doc(`tenantSlugs/${tenant.slug}`), {
    tenantId: null,
    status: "quarantined",
    quarantinedUntil: Timestamp.fromMillis(now.getTime() + SLUG_QUARANTINE_DAYS * DAY),
  });
  batch.set(db.collection("tenantTombstones").doc(tenantId), {
    tenantId,
    agencyId: tenant.agencyId,
    deletedAt: FieldValue.serverTimestamp(),
    requestedBy: tenant.deletionRequestedBy ?? null,
    expireAt: Timestamp.fromMillis(now.getTime() + 730 * DAY),
  });
  batch.update(db.doc(`agencies/${tenant.agencyId}`), {
    "usage.workspaces": FieldValue.increment(-1),
  });
  audit(
    batch,
    { agencyId: tenant.agencyId },
    {
      action: "tenant.purged",
      actor: { type: "system" },
      target: { type: "tenant", id: tenantId },
      requestId: "job_tenant_purge",
    },
  );
  await batch.commit();
  // Post-purge verification (FR-TEN-006 AC5).
  const leftovers = await ref.listCollections();
  const remaining = (await Promise.all(leftovers.map((c) => c.limit(1).get()))).some(
    (s) => !s.empty,
  );
  if (remaining || (await ref.get()).exists) {
    logger.error("tenant_purge_incomplete", { tenantId });
    throw new Error("tenant_purge_incomplete");
  }
  clearTenantCaches();
  return true;
}

/** Daily job body: purge every tenant past its grace period. */
export async function purgeDueTenants(now = new Date()): Promise<number> {
  const snap = await getDb()
    .collection("tenants")
    .where("status", "==", "pending_deletion")
    .orderBy("deletionScheduledFor", "asc")
    .limit(20)
    .get();
  let purged = 0;
  for (const d of snap.docs) if (await purgeTenant(d.id, now)) purged++;
  return purged;
}
