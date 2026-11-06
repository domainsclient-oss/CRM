import "server-only";
import { FieldPath, Timestamp, type DocumentData, type Query } from "firebase-admin/firestore";
import { toCsv } from "@crm/shared/csv";
import { addDays, zonedToUtc } from "@crm/shared/records/time";
import { AUDIT_ACTIONS } from "./audit";
import { authorize } from "./authz";
import { PlanLimitError, getEffectiveConfig } from "./config/entitlements";
import type { TenantContext } from "./contexts/tenant-context";
import { ValidationError } from "./errors";
import { decodeCursor, encodeCursor } from "./records/cursor";
import { iso } from "./records/plain";
import { readTenantSettings } from "./records/workspace-data";
import { assertSafeId, tenantCollection } from "./repositories/base";

// Audit viewer (FR-AUD-002): Owner/Admin; filter by ONE of action or actor plus an optional date
// range (allowlisted shapes); cursor pagination; CSV export when the plan has auditExport.
// Read-only — nothing here can modify audit entries (FR-AUD-003).

export interface AuditFilter {
  action: string | null;
  actorUid: string | null;
  from: string | null;
  to: string | null;
}

export interface AuditRow {
  id: string;
  createdAt: string | null;
  action: string;
  actorType: string;
  actorUid: string | null;
  targetType: string;
  targetId: string;
  changedFields: string[];
  meta: Record<string, unknown>;
}

function query(ctx: TenantContext, f: AuditFilter): { q: Query<DocumentData>; shape: string } {
  if (f.action && f.actorUid) {
    throw new ValidationError({ filter: ["Filter by action or by user, not both"] });
  }
  if (f.action && !(AUDIT_ACTIONS as readonly string[]).includes(f.action)) {
    throw new ValidationError({ action: ["Unknown action"] });
  }
  let q: Query<DocumentData> = tenantCollection(ctx, "auditLogs");
  let shape = "audit.all";
  if (f.action) {
    q = q.where("action", "==", f.action);
    shape = "audit.byAction";
  } else if (f.actorUid) {
    assertSafeId(f.actorUid);
    q = q.where("actor.uid", "==", f.actorUid);
    shape = "audit.byActor";
  }
  const tz = readTenantSettings(ctx).timezone;
  if (f.from) q = q.where("createdAt", ">=", Timestamp.fromDate(zonedToUtc(f.from, "00:00", tz)));
  if (f.to)
    q = q.where("createdAt", "<", Timestamp.fromDate(zonedToUtc(addDays(f.to, 1), "00:00", tz)));
  return { q: q.orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc"), shape };
}

function row(id: string, d: DocumentData): AuditRow {
  return {
    id,
    createdAt: iso(d.createdAt),
    action: String(d.action),
    actorType: String(d.actor?.type ?? ""),
    actorUid: (d.actor?.uid as string | null | undefined) ?? null,
    targetType: String(d.target?.type ?? ""),
    targetId: String(d.target?.id ?? ""),
    changedFields: (d.changedFields as string[] | undefined) ?? [],
    meta: (d.meta as Record<string, unknown> | undefined) ?? {},
  };
}

export async function listAudit(ctx: TenantContext, f: AuditFilter, cursor: string | null) {
  authorize(ctx, "audit.read");
  const { q, shape } = query(ctx, f);
  const after = decodeCursor(shape, cursor);
  const snap = await (after ? q.startAfter(after[0], after[1]) : q).limit(51).get();
  const docs = snap.docs.slice(0, 50);
  const last = docs.at(-1);
  return {
    rows: docs.map((d) => row(d.id, d.data())),
    nextCursor:
      snap.docs.length > 50 && last ? encodeCursor(shape, last.get("createdAt"), last.id) : null,
  };
}

/** CSV of up to 10,000 matching entries (plan feature `auditExport`). */
export async function exportAudit(ctx: TenantContext, f: AuditFilter): Promise<string> {
  authorize(ctx, "audit.read");
  if (!(await getEffectiveConfig(ctx)).features.auditExport)
    throw new PlanLimitError("audit_export");
  const { q } = query(ctx, f);
  const snap = await q.limit(10_000).get();
  return toCsv([
    ["time", "action", "actorType", "actorUid", "targetType", "targetId", "changedFields"],
    ...snap.docs.map((d) => {
      const r = row(d.id, d.data());
      return [
        r.createdAt,
        r.action,
        r.actorType,
        r.actorUid,
        r.targetType,
        r.targetId,
        r.changedFields,
      ];
    }),
  ]);
}
