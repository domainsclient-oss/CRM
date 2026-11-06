import "server-only";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { workspaceScope } from "@crm/shared/permissions";
import type { ActivityInput, RelatedType } from "@crm/shared/records/schemas";
import { zonedToUtc } from "@crm/shared/records/time";
import { authorize } from "../authz";
import type { TenantContext } from "../contexts/tenant-context";
import { NotFoundError, ValidationError } from "../errors";
import { getDb } from "../firebase-admin";
import { assertSafeId, getById, tenantCollection } from "../repositories/base";
import {
  COLLECTION_OF,
  auditRecord,
  loadReference,
  newRecordFields,
  relatedKey,
  touchFields,
  type RelatedLabel,
} from "./common";
import { decodeCursor, encodeCursor } from "./cursor";
import { toPlain } from "./plain";
import { viewerTimeZone } from "./tasks";

// Activities & timeline (FR-ACT-001/002). An activity is visible through the records it relates
// to: the timeline is only queried after the record itself passed getById (own-scope for
// Members), and every related record must be visible to the author when logging.

const TIMELINE_SHAPE = "activities.timeline";
export const TIMELINE_PAGE = 20;

export async function logActivity(ctx: TenantContext, input: ActivityInput) {
  authorize(ctx, "record.create");
  const keys = new Set(input.related.map(relatedKey));
  if (keys.size !== input.related.length) {
    throw new ValidationError({ related: ["Each record can be linked once"] });
  }
  const tz = await viewerTimeZone(ctx);
  const occurredAt = Timestamp.fromDate(zonedToUtc(input.occurredDate, input.occurredTime, tz));
  return getDb().runTransaction(async (tx) => {
    const refs = [];
    for (const r of input.related) {
      refs.push({ r, loaded: await loadReference(tx, ctx, r.type, r.id, "related") });
    }
    const related: RelatedLabel[] = refs.map(({ r, loaded }) => ({ ...r, label: loaded.label }));
    const ref = tenantCollection(ctx, "activities").doc();
    tx.create(ref, {
      ...newRecordFields(ctx, ref.id),
      type: input.type,
      systemEvent: null,
      subject: input.subject,
      body: input.body,
      occurredAt,
      durationMinutes: input.durationMinutes,
      outcome: input.outcome,
      related,
      relatedKeys: related.map(relatedKey),
      metadata: {},
    });
    for (const { loaded } of refs) {
      const last = loaded.data.lastActivityAt as Timestamp | null | undefined;
      if (!last || last.toMillis() < occurredAt.toMillis()) {
        tx.update(loaded.ref, { lastActivityAt: occurredAt });
      }
    }
    auditRecord(tx, ctx, "activity.created", { type: "activity", id: ref.id });
    return { id: ref.id };
  });
}

export interface TimelinePage {
  items: Array<Record<string, unknown> & { id: string }>;
  nextCursor: string | null;
}

export async function listTimeline(
  ctx: TenantContext,
  type: RelatedType,
  id: string,
  cursor: string | null,
): Promise<TimelinePage> {
  const collection = type === "lead" ? "leads" : COLLECTION_OF[type];
  await getById(ctx, collection, id); // visibility of the record gates its timeline
  let query = tenantCollection(ctx, "activities")
    .where("isDeleted", "==", false)
    .where("relatedKeys", "array-contains", relatedKey({ type, id }))
    .orderBy("occurredAt", "desc")
    .orderBy(FieldPath.documentId(), "desc");
  const after = decodeCursor(TIMELINE_SHAPE, cursor);
  if (after) query = query.startAfter(after[0], after[1]);
  const snap = await query.limit(TIMELINE_PAGE + 1).get();
  const docs = snap.docs.slice(0, TIMELINE_PAGE);
  const last = docs.at(-1);
  return {
    items: docs.map((d) => ({ ...(toPlain(d.data()) as Record<string, unknown>), id: d.id })),
    nextCursor:
      snap.docs.length > TIMELINE_PAGE && last
        ? encodeCursor(TIMELINE_SHAPE, last.get("occurredAt"), last.id)
        : null,
  };
}

/** Authors delete their own logged activities; Manager+ any. System entries are permanent. */
export async function deleteActivity(ctx: TenantContext, id: string) {
  authorize(ctx, "record.delete");
  assertSafeId(id);
  return getDb().runTransaction(async (tx) => {
    const ref = tenantCollection(ctx, "activities").doc(id);
    const data = (await tx.get(ref)).data();
    if (!data || data.isDeleted || data.tenantId !== ctx.tenantId || data.type === "system") {
      throw new NotFoundError();
    }
    const isAuthor = data.createdBy === ctx.uid;
    if (!isAuthor && workspaceScope(ctx.role, "record.delete") !== "all") throw new NotFoundError();
    tx.update(ref, {
      isDeleted: true,
      deletedAt: Timestamp.now(),
      deletedBy: ctx.uid,
      ...touchFields(ctx),
    });
    auditRecord(tx, ctx, "activity.deleted", { type: "activity", id });
    return { id };
  });
}
