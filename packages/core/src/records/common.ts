import "server-only";
import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type Transaction,
} from "firebase-admin/firestore";
import { MAX_TAG_CATALOG, tagId } from "@crm/shared/records/normalize";
import type { RelatedType } from "@crm/shared/records/schemas";
import { workspaceScope, type WorkspacePermission } from "@crm/shared/permissions";
import { audit, type AuditAction } from "../audit";
import { authorize, canActOnRecord } from "../authz";
import type { TenantContext } from "../contexts/tenant-context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { MemberDoc } from "../model";
import {
  OWNED_COLLECTIONS,
  assertSafeId,
  canReadRecord,
  tenantCollection,
  type OwnedCollection,
} from "../repositories/base";

// Building blocks shared by every record service (T-04-02..07). Rules enforced here once:
// owners are active, non-viewer members; reassigning needs record.reassign; Members act only on
// their own records; updates carry the `updatedAt` the editor saw (optimistic concurrency);
// audit + system activity + usage counters are written in the same transaction as the change.

export type RecordType = "company" | "contact" | "lead" | "deal" | "task";

export const COLLECTION_OF: Record<RecordType, OwnedCollection> = {
  company: "companies",
  contact: "contacts",
  lead: "leads",
  deal: "deals",
  task: "tasks",
};

export function recordLabel(type: RecordType | RelatedType, doc: DocumentData): string {
  switch (type) {
    case "company":
    case "deal":
      return String(doc.name ?? "");
    case "contact":
    case "lead":
      return [doc.firstName, doc.lastName].filter(Boolean).join(" ");
    case "task":
      return String(doc.title ?? "");
  }
}

export interface RelatedLabel {
  type: RelatedType;
  id: string;
  label: string;
}

export const relatedKey = (r: { type: string; id: string }) => `${r.type}:${r.id}`;

/** Fields every new record gets (requirements/03 §3). */
export function newRecordFields(ctx: TenantContext, id: string) {
  return {
    id,
    tenantId: ctx.tenantId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: ctx.uid,
    updatedBy: ctx.uid,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    schemaVersion: 1,
  };
}

export function touchFields(ctx: TenantContext) {
  return { updatedAt: FieldValue.serverTimestamp(), updatedBy: ctx.uid };
}

/**
 * Owner for a create/update. Members can only own their records; assigning anyone else needs
 * record.reassign. The target must be an active member who can write (not a viewer).
 */
export async function resolveOwner(
  tx: Transaction,
  ctx: TenantContext,
  requested: string | null,
  current?: string,
): Promise<string> {
  const target = requested ?? current ?? ctx.uid;
  if (target !== (current ?? ctx.uid)) authorize(ctx, "record.reassign");
  if (target === current) return target;
  assertSafeId(target);
  const member = (await tx.get(tenantCollection(ctx, "members").doc(target))).data() as
    MemberDoc | undefined;
  if (!member || member.status !== "active" || member.role === "viewer") {
    throw new ValidationError({ ownerUid: ["Choose an active team member"] }, "invalid_owner");
  }
  return target;
}

/**
 * Load a record inside a transaction with the same visibility rules as getById, then check the
 * actor's permission on it (own-scope for Members). Hidden and missing records are NotFound.
 */
export async function loadForWrite(
  tx: Transaction,
  ctx: TenantContext,
  collection: OwnedCollection,
  id: string,
  permission: WorkspacePermission,
  opts: { includeDeleted?: boolean } = {},
): Promise<{ ref: DocumentReference; data: DocumentData }> {
  assertSafeId(id);
  const ref = tenantCollection(ctx, collection).doc(id);
  const data = (await tx.get(ref)).data();
  if (!data || data.tenantId !== ctx.tenantId) throw new NotFoundError();
  if (data.isDeleted === true && !opts.includeDeleted) throw new NotFoundError();
  if (!canReadRecord(ctx, collection, data)) throw new NotFoundError();
  const ownerField = OWNED_COLLECTIONS[collection];
  if (!canActOnRecord(ctx, permission, { ownerUid: data[ownerField] as string })) {
    authorize(ctx, permission); // throws Forbidden when the role lacks it entirely
    throw new NotFoundError(); // "own" scope on someone else's record: don't reveal it
  }
  return { ref, data };
}

/** Optimistic concurrency (03 §12): the editor's `updatedAt` must still be current. */
export function assertUnchanged(data: DocumentData, expectedUpdatedAt: string): void {
  const actual = data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : null;
  if (actual !== expectedUpdatedAt) throw new ConflictError("stale_record");
}

/** Visible, non-deleted reference (e.g. a contact's company) → its label; else validation error. */
export async function loadReference(
  tx: Transaction,
  ctx: TenantContext,
  type: RelatedType,
  id: string,
  field: string,
): Promise<{ ref: DocumentReference; data: DocumentData; label: string }> {
  const collection = type === "lead" ? "leads" : COLLECTION_OF[type];
  assertSafeId(id);
  const ref = tenantCollection(ctx, collection).doc(id);
  const data = (await tx.get(ref)).data();
  if (
    !data ||
    data.isDeleted === true ||
    data.tenantId !== ctx.tenantId ||
    !canReadRecord(ctx, collection, data)
  ) {
    throw new ValidationError({ [field]: ["Choose an existing record"] }, "invalid_reference");
  }
  return { ref, data, label: recordLabel(type, data) };
}

/** Field names whose values differ (for audit `changedFields` — names only, never values). */
export function changedFields(before: DocumentData, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter(
    (k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null),
  );
}

// ---- Tags catalog (FR-REC-002) ----

/**
 * Reads for a tag change (call before any write in the transaction); returns the writer.
 * New tags are added to the tenant catalog (max 500); usage counts follow add/remove.
 */
export async function prepareTags(
  tx: Transaction,
  ctx: TenantContext,
  before: string[],
  after: string[],
): Promise<() => void> {
  const added = after.filter((t) => !before.includes(t));
  const removed = before.filter((t) => !after.includes(t));
  if (added.length === 0 && removed.length === 0) return () => {};
  const defs = tenantCollection(ctx, "tagDefinitions");
  const addedRefs = added.map((name) => ({ name, ref: defs.doc(tagId(name)) }));
  const existing = addedRefs.length > 0 ? await tx.getAll(...addedRefs.map((a) => a.ref)) : [];
  const missing = addedRefs.filter((_, i) => !existing[i]?.exists);
  if (missing.length > 0) {
    const count = (await tx.get(defs.count())).data().count;
    if (count + missing.length > MAX_TAG_CATALOG) {
      throw new ValidationError({ tags: [`A workspace can have at most ${MAX_TAG_CATALOG} tags`] });
    }
  }
  return () => {
    for (const { name, ref } of addedRefs) {
      tx.set(
        ref,
        { name, nameNormalized: name, color: null, usageCount: FieldValue.increment(1) },
        { merge: true },
      );
    }
    for (const name of removed) {
      tx.set(defs.doc(tagId(name)), { usageCount: FieldValue.increment(-1) }, { merge: true });
    }
  };
}

// ---- Activities, audit, usage ----

export type SystemEvent =
  | "record.created"
  | "record.owner_changed"
  | "record.deleted"
  | "record.restored"
  | "contact.lifecycle_changed"
  | "contact.company_changed"
  | "lead.converted"
  | "deal.stage_changed"
  | "deal.won"
  | "deal.lost"
  | "deal.reopened"
  | "task.completed"
  | "task.reopened";

/** FR-ACT-002: non-editable timeline entries. Metadata holds enums/ids only (no PII). */
export function systemActivity(
  tx: Transaction,
  ctx: TenantContext,
  event: SystemEvent,
  related: RelatedLabel[],
  metadata: Record<string, string | null> = {},
): void {
  const ref = tenantCollection(ctx, "activities").doc();
  tx.create(ref, {
    ...newRecordFields(ctx, ref.id),
    type: "system",
    systemEvent: event,
    subject: "",
    body: null,
    occurredAt: FieldValue.serverTimestamp(),
    durationMinutes: null,
    outcome: null,
    related,
    relatedKeys: related.map(relatedKey),
    metadata,
  });
}

export function auditRecord(
  tx: Transaction,
  ctx: TenantContext,
  action: AuditAction,
  target: { type: string; id: string },
  extra: { changedFields?: string[]; meta?: Record<string, string | number | boolean | null> } = {},
): void {
  audit(
    tx,
    { tenantId: ctx.tenantId },
    {
      action,
      actor: { type: "user", uid: ctx.uid },
      target,
      ...(extra.changedFields ? { changedFields: extra.changedFields } : {}),
      ...(extra.meta ? { meta: extra.meta } : {}),
      requestId: ctx.requestId,
    },
  );
}

/** usage/current counters (03 §5), incremented in the same transaction as creates/deletes. */
export function bumpUsage(
  tx: Transaction,
  ctx: Pick<TenantContext, "tenantId">,
  collection: OwnedCollection,
  delta: number,
): void {
  if (collection === "tasks") return; // tasks don't count toward record limits
  tx.set(
    tenantCollection(ctx, "usage").doc("current"),
    {
      records: FieldValue.increment(delta),
      [collection]: FieldValue.increment(delta),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** Denormalized company counters (eventually consistent display values). */
export function bumpCompanyCounts(
  tx: Transaction,
  ctx: Pick<TenantContext, "tenantId">,
  companyId: string | null | undefined,
  counts: { contacts?: number; openDeals?: number },
): void {
  if (!companyId || (!counts.contacts && !counts.openDeals)) return;
  // set+merge with a nested map: update() would abort the transaction on a purged company.
  tx.set(
    tenantCollection(ctx, "companies").doc(companyId),
    {
      counts: {
        ...(counts.contacts ? { contacts: FieldValue.increment(counts.contacts) } : {}),
        ...(counts.openDeals ? { openDeals: FieldValue.increment(counts.openDeals) } : {}),
      },
    },
    { merge: true },
  );
}

export function can(ctx: TenantContext, permission: WorkspacePermission): boolean {
  return workspaceScope(ctx.role, permission) !== null;
}
