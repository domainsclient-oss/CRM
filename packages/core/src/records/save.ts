import "server-only";
import type { DocumentData, Transaction } from "firebase-admin/firestore";
import { authorize } from "../authz";
import { assertRecordCapacity } from "../config/entitlements";
import type { TenantContext } from "../contexts/tenant-context";
import { getDb } from "../firebase-admin";
import { OWNED_COLLECTIONS, tenantCollection } from "../repositories/base";
import { notify } from "../notifications";
import {
  COLLECTION_OF,
  assertUnchanged,
  auditRecord,
  bumpUsage,
  changedFields,
  loadForWrite,
  newRecordFields,
  prepareTags,
  recordLabel,
  resolveOwner,
  systemActivity,
  touchFields,
  type RecordType,
  type RelatedLabel,
} from "./common";

// Create/update engine shared by every record type. The entity's `prepare` does its own reads
// (references, duplicates) and returns the fields to store; the engine then resolves the owner,
// syncs the tag catalog, writes the record, and records audit + system activity + usage — all in
// one transaction, reads strictly before writes (Firestore transaction rule).

export interface Prepared {
  fields: Record<string, unknown>;
  /** Requested owner (null = keep current, or the actor on create). */
  owner: string | null;
  tags?: string[];
  /** Entity-specific writes after the record write (counters, extra activities). */
  effects?: (tx: Transaction, saved: Saved) => void;
}

export interface Saved {
  id: string;
  self: RelatedLabel | null;
  before: DocumentData | null;
  after: Record<string, unknown>;
}

export type SaveTarget = { id: string; expectedUpdatedAt: string } | null;

const RELATED: Partial<Record<RecordType, RelatedLabel["type"]>> = {
  company: "company",
  contact: "contact",
  lead: "lead",
  deal: "deal",
};

export function selfLabel(type: RecordType, id: string, data: DocumentData): RelatedLabel | null {
  const related = RELATED[type];
  return related ? { type: related, id, label: recordLabel(type, data) } : null;
}

export async function saveRecord(
  ctx: TenantContext,
  type: RecordType,
  target: SaveTarget,
  prepare: (tx: Transaction, existing: DocumentData | null) => Promise<Prepared>,
): Promise<{ id: string }> {
  const collection = COLLECTION_OF[type];
  const ownerField = OWNED_COLLECTIONS[collection];
  authorize(ctx, target ? "record.update" : "record.create");

  let assigned: { uid: string; label: string } | null = null;
  const result = await getDb().runTransaction(async (tx) => {
    assigned = null; // transactions may retry
    const existing = target
      ? await loadForWrite(tx, ctx, collection, target.id, "record.update")
      : null;
    if (existing && target) assertUnchanged(existing.data, target.expectedUpdatedAt);
    const ref = existing?.ref ?? tenantCollection(ctx, collection).doc();
    const before = existing?.data ?? null;

    const prepared = await prepare(tx, before);
    if (!before && collection !== "tasks") await assertRecordCapacity(tx, ctx, 1);
    const owner = await resolveOwner(
      tx,
      ctx,
      prepared.owner,
      before ? (before[ownerField] as string) : undefined,
    );
    const writeTags = await prepareTags(
      tx,
      ctx,
      (before?.tags as string[] | undefined) ?? [],
      prepared.tags ?? [],
    );

    const after: Record<string, unknown> = {
      ...prepared.fields,
      [ownerField]: owner,
      ownerUid: owner,
      ...(prepared.tags ? { tags: prepared.tags } : {}),
    };
    const self = selfLabel(type, ref.id, after);
    const saved: Saved = { id: ref.id, self, before, after };

    if (before) {
      const changed = changedFields(before, after);
      if (changed.length === 0) return { id: ref.id };
      tx.update(ref, { ...after, ...touchFields(ctx) });
      auditRecord(tx, ctx, "record.updated", { type, id: ref.id }, { changedFields: changed });
      if (owner !== before[ownerField]) {
        auditRecord(tx, ctx, "record.reassigned", { type, id: ref.id });
        if (self) systemActivity(tx, ctx, "record.owner_changed", [self]);
      }
    } else {
      tx.create(ref, { ...newRecordFields(ctx, ref.id), lastActivityAt: null, ...after });
      bumpUsage(tx, ctx, collection, 1);
      auditRecord(tx, ctx, "record.created", { type, id: ref.id });
      if (self) systemActivity(tx, ctx, "record.created", [self]);
    }
    writeTags();
    prepared.effects?.(tx, saved);
    if (owner !== ctx.uid && owner !== (before?.[ownerField] as string | undefined)) {
      assigned = { uid: owner, label: recordLabel(type, after) };
    }
    return { id: ref.id };
  });
  const toNotify = assigned as { uid: string; label: string } | null;
  if (toNotify) {
    await notify({
      tenantId: ctx.tenantId,
      recipientUid: toNotify.uid,
      type: "record_assigned",
      title: toNotify.label,
      link: `/${collection}/${result.id}`,
    });
  }
  return result;
}
