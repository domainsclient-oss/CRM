import "server-only";
import {
  FieldPath,
  Timestamp,
  type DocumentData,
  type Transaction,
} from "firebase-admin/firestore";
import { audit } from "../audit";
import { authorize } from "../authz";
import { assertRecordCapacity } from "../config/entitlements";
import type { TenantContext } from "../contexts/tenant-context";
import { NotFoundError } from "../errors";
import { getDb } from "../firebase-admin";
import { logger } from "../logger";
import { OWNED_COLLECTIONS, tenantCollection, type OwnedCollection } from "../repositories/base";
import {
  COLLECTION_OF,
  auditRecord,
  bumpCompanyCounts,
  bumpUsage,
  loadForWrite,
  recordLabel,
  relatedKey,
  resolveOwner,
  systemActivity,
  touchFields,
  type RecordType,
} from "./common";
import { decodeCursor, encodeCursor } from "./cursor";
import { toPlain } from "./plain";
import { notify } from "../notifications";
import { selfLabel } from "./save";

// Soft delete, trash, restore, purge (FR-REC-001), and owner reassignment (FR-RBAC-004 AC5).

export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Counter effects of a record leaving (-1) or re-entering (+1) the active set. */
function activeSetEffects(
  tx: Transaction,
  ctx: TenantContext,
  type: RecordType,
  data: DocumentData,
  delta: 1 | -1,
) {
  bumpUsage(tx, ctx, COLLECTION_OF[type], delta);
  if (type === "contact") bumpCompanyCounts(tx, ctx, data.companyId, { contacts: delta });
  if (type === "deal" && data.status === "open") {
    bumpCompanyCounts(tx, ctx, data.companyId, { openDeals: delta });
  }
}

export async function softDeleteRecord(ctx: TenantContext, type: RecordType, id: string) {
  authorize(ctx, "record.delete");
  return getDb().runTransaction(async (tx) => {
    const { ref, data } = await loadForWrite(tx, ctx, COLLECTION_OF[type], id, "record.delete");
    tx.update(ref, {
      isDeleted: true,
      deletedAt: Timestamp.now(),
      deletedBy: ctx.uid,
      ...touchFields(ctx),
    });
    activeSetEffects(tx, ctx, type, data, -1);
    auditRecord(tx, ctx, "record.deleted", { type, id });
    const self = selfLabel(type, id, data);
    if (self) systemActivity(tx, ctx, "record.deleted", [self]);
    return { id };
  });
}

export async function restoreRecord(ctx: TenantContext, type: RecordType, id: string) {
  authorize(ctx, "record.restore");
  return getDb().runTransaction(async (tx) => {
    const { ref, data } = await loadForWrite(tx, ctx, COLLECTION_OF[type], id, "record.restore", {
      includeDeleted: true,
    });
    if (data.isDeleted !== true) throw new NotFoundError();
    if (type !== "task") await assertRecordCapacity(tx, ctx, 1);
    tx.update(ref, { isDeleted: false, deletedAt: null, deletedBy: null, ...touchFields(ctx) });
    activeSetEffects(tx, ctx, type, data, 1);
    auditRecord(tx, ctx, "record.restored", { type, id });
    const self = selfLabel(type, id, data);
    if (self) systemActivity(tx, ctx, "record.restored", [self]);
    return { id };
  });
}

/** Manager+ reassignment; the previous owner (a Member) loses access on the next request. */
export async function reassignRecord(
  ctx: TenantContext,
  type: RecordType,
  id: string,
  ownerUid: string,
) {
  authorize(ctx, "record.reassign");
  const collection = COLLECTION_OF[type];
  const ownerField = OWNED_COLLECTIONS[collection];
  return getDb()
    .runTransaction(async (tx) => {
      const { ref, data } = await loadForWrite(tx, ctx, collection, id, "record.update");
      const current = String(data[ownerField]);
      const owner = await resolveOwner(tx, ctx, ownerUid, current);
      if (owner === current) return { id, notifyUid: null, label: "" };
      tx.update(ref, { [ownerField]: owner, ownerUid: owner, ...touchFields(ctx) });
      auditRecord(tx, ctx, "record.reassigned", { type, id });
      const self = selfLabel(type, id, data);
      if (self) systemActivity(tx, ctx, "record.owner_changed", [self]);
      return { id, notifyUid: owner === ctx.uid ? null : owner, label: recordLabel(type, data) };
    })
    .then(async (r) => {
      if (r.notifyUid) {
        await notify({
          tenantId: ctx.tenantId,
          recipientUid: r.notifyUid,
          type: "record_assigned",
          title: r.label,
          link: `/${collection}/${id}`,
        });
      }
      return { id: r.id };
    });
}

export interface TrashItem {
  type: RecordType;
  id: string;
  label: string;
  deletedAt: string | null;
  deletedBy: string | null;
}

/** Trash page (Manager+): newest deletions first, one entity type at a time. */
export async function listTrash(
  ctx: TenantContext,
  type: RecordType,
  cursor: string | null,
): Promise<{ items: TrashItem[]; nextCursor: string | null }> {
  authorize(ctx, "record.restore");
  const collection = COLLECTION_OF[type];
  const shape = `trash.${collection}`;
  let query = tenantCollection(ctx, collection)
    .where("isDeleted", "==", true)
    .orderBy("deletedAt", "desc")
    .orderBy(FieldPath.documentId(), "desc");
  const after = decodeCursor(shape, cursor);
  if (after) query = query.startAfter(after[0], after[1]);
  const snap = await query.limit(26).get();
  const docs = snap.docs.slice(0, 25);
  const last = docs.at(-1);
  return {
    items: docs.map((d) => {
      const plain = toPlain(d.data()) as Record<string, unknown>;
      return {
        type,
        id: d.id,
        label: recordLabel(type, d.data()),
        deletedAt: (plain.deletedAt as string | null) ?? null,
        deletedBy: (plain.deletedBy as string | null) ?? null,
      };
    }),
    nextCursor:
      snap.docs.length > 25 && last ? encodeCursor(shape, last.get("deletedAt"), last.id) : null,
  };
}

/**
 * Hard delete of one trashed record (FR-REC-001 AC3/AC4): activities related only to it are
 * deleted; a purged company's contacts/deals are unlinked. Cleanup runs first (idempotent), then
 * the record itself is removed in a transaction that re-checks it is still in the trash.
 */
async function purgeInternal(
  tenantId: string,
  collection: OwnedCollection,
  id: string,
  audit: (tx: Transaction) => void,
): Promise<boolean> {
  const ctxLike = { tenantId };
  const type = Object.entries(COLLECTION_OF).find(([, c]) => c === collection)![0] as RecordType;
  const ref = tenantCollection(ctxLike, collection).doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.get("isDeleted") !== true) return false;

  if (type !== "task") {
    const key = relatedKey({ type, id });
    for (;;) {
      const acts = await tenantCollection(ctxLike, "activities")
        .where("relatedKeys", "array-contains", key)
        .limit(400)
        .get();
      const batch = getDb().batch();
      let writes = 0;
      for (const doc of acts.docs) {
        const keys = (doc.get("relatedKeys") as string[]) ?? [];
        if (keys.length <= 1) batch.delete(doc.ref);
        else {
          batch.update(doc.ref, {
            relatedKeys: keys.filter((k) => k !== key),
            related: ((doc.get("related") as Array<{ type: string; id: string }>) ?? []).filter(
              (r) => relatedKey(r) !== key,
            ),
          });
        }
        writes++;
      }
      if (writes === 0) break;
      await batch.commit();
      if (acts.size < 400) break;
    }
  }
  if (type === "company") {
    for (const coll of ["contacts", "deals"] as const) {
      for (;;) {
        const linked = await tenantCollection(ctxLike, coll)
          .where("companyId", "==", id)
          .limit(400)
          .get();
        if (linked.empty) break;
        const batch = getDb().batch();
        for (const doc of linked.docs)
          batch.update(doc.ref, { companyId: null, companyName: null });
        await batch.commit();
      }
    }
  }
  return getDb().runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists || current.get("isDeleted") !== true) return false;
    tx.delete(ref);
    audit(tx);
    return true;
  });
}

export async function purgeRecord(ctx: TenantContext, type: RecordType, id: string) {
  authorize(ctx, "record.restore"); // record.purge shares this grant (permission matrix row)
  const collection = COLLECTION_OF[type];
  await getDb().runTransaction(async (tx) => {
    await loadForWrite(tx, ctx, collection, id, "record.restore", { includeDeleted: true });
  });
  const purged = await purgeInternal(ctx.tenantId, collection, id, (tx) =>
    auditRecord(tx, ctx, "record.purged", { type, id }),
  );
  if (!purged) throw new NotFoundError();
  return { id };
}

/**
 * Scheduled job body (daily; scheduling arrives with Cloud Functions, T-01-09): purge records
 * trashed more than 30 days ago in one tenant. Returns the number purged.
 */
export async function purgeExpiredTrash(tenantId: string, now = new Date()): Promise<number> {
  const cutoff = Timestamp.fromMillis(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS);
  let purged = 0;
  for (const collection of Object.keys(OWNED_COLLECTIONS) as OwnedCollection[]) {
    for (;;) {
      const snap = await tenantCollection({ tenantId }, collection)
        .where("isDeleted", "==", true)
        .where("deletedAt", "<", cutoff)
        .orderBy("deletedAt", "desc")
        .limit(100)
        .get();
      if (snap.empty) break;
      for (const doc of snap.docs) {
        const ok = await purgeInternal(tenantId, collection, doc.id, (tx) =>
          audit(
            tx,
            { tenantId },
            {
              action: "record.purged",
              actor: { type: "system" },
              target: { type: collection, id: doc.id },
              meta: { reason: "retention" },
              requestId: "job_purge_trash",
            },
          ),
        );
        if (ok) purged++;
      }
      if (snap.size < 100) break;
    }
  }
  logger.info("trash_purged", { tenantId, purged });
  return purged;
}
