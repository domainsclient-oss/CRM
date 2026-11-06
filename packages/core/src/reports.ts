import "server-only";
import { AggregateField, Timestamp, type DocumentData, type Query } from "firebase-admin/firestore";
import { workspaceScope } from "@crm/shared/permissions";
import { LEAD_SOURCES } from "@crm/shared/records/schemas";
import { addDays, dayKey, zonedToUtc } from "@crm/shared/records/time";
import { authorize } from "./authz";
import type { TenantContext } from "./contexts/tenant-context";
import { ValidationError } from "./errors";
import { getPipeline, PIPELINE_ID } from "./records/deals";
import { toPlain } from "./records/plain";
import { myDueTaskCount } from "./records/tasks";
import { readTenantSettings } from "./records/workspace-data";
import { scopedQuery, tenantCollection, type OwnedCollection } from "./repositories/base";

// Dashboard and standard reports (FR-DASH-001/002, FR-RPT-001). Aggregation queries only (count,
// sum) — no collection scans. Members always see only their own data (scopedQuery adds the owner
// filter); Managers, Admins, Owners and Viewers see the workspace, optionally filtered by owner.
// Month boundaries are computed in the workspace time zone.

export interface Scope {
  /** Optional owner filter for workspace-wide roles (ignored for Members). */
  ownerUid: string | null;
}

function base(ctx: TenantContext, collection: OwnedCollection, scope: Scope): Query<DocumentData> {
  let q = scopedQuery(ctx, collection);
  if (scope.ownerUid && workspaceScope(ctx.role, "report.read") === "all") {
    q = q.where(collection === "tasks" ? "assigneeUid" : "ownerUid", "==", scope.ownerUid);
  }
  return q;
}

const count = async (q: Query<DocumentData>) => (await q.count().get()).data().count;
async function countSum(q: Query<DocumentData>, field: string) {
  const r = (
    await q.aggregate({ count: AggregateField.count(), sum: AggregateField.sum(field) }).get()
  ).data();
  return { count: r.count, sum: r.sum ?? 0 };
}

function monthStart(key: string): string {
  return `${key.slice(0, 7)}-01`;
}
function addMonths(first: string, n: number): string {
  const [y, m] = first.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}
const ts = (key: string, tz: string) => Timestamp.fromDate(zonedToUtc(key, "00:00", tz));

export async function pipelineByStage(ctx: TenantContext, scope: Scope) {
  authorize(ctx, "report.read");
  const pipeline = await getPipeline(ctx);
  const open = pipeline.stages.filter((s) => s.kind === "open");
  return Promise.all(
    open.map(async (stage) => ({
      stageId: stage.id,
      stage: stage.name,
      ...(await countSum(
        base(ctx, "deals", scope)
          .where("pipelineId", "==", PIPELINE_ID)
          .where("status", "==", "open")
          .where("stageId", "==", stage.id),
        "amount",
      )),
    })),
  );
}

async function closedInRange(
  ctx: TenantContext,
  scope: Scope,
  status: "won" | "lost",
  from: Timestamp,
  to: Timestamp,
) {
  return countSum(
    base(ctx, "deals", scope)
      .where("status", "==", status)
      .where("closedAt", ">=", from)
      .where("closedAt", "<", to),
    "amount",
  );
}

export interface Dashboard {
  pipeline: Awaited<ReturnType<typeof pipelineByStage>>;
  wonThisMonth: { count: number; sum: number };
  wonLastMonth: { count: number; sum: number };
  newLeadsThisMonth: number;
  conversion: { converted: number; total: number; rate: number };
  myTasksDue: number;
  recent: Array<{
    id: string;
    type: string;
    subject: string;
    systemEvent: string | null;
    occurredAt: string | null;
    related: Array<{ type: string; id: string; label: string }>;
  }>;
}

/** Each widget is computed independently; a failing widget returns null (FR-DASH-001 AC2). */
export async function getDashboard(
  ctx: TenantContext,
  scope: Scope,
): Promise<{ [K in keyof Dashboard]: Dashboard[K] | null }> {
  authorize(ctx, "report.read");
  const tz = readTenantSettings(ctx).timezone;
  const today = dayKey(new Date(), tz);
  const thisMonth = monthStart(today);
  const lastMonth = addMonths(thisMonth, -1);
  const nextMonth = addMonths(thisMonth, 1);
  const since90 = ts(addDays(today, -90), tz);
  const safe = <T>(p: Promise<T>) => p.catch(() => null);
  const [pipeline, wonThisMonth, wonLastMonth, newLeadsThisMonth, conversion, myTasksDue, recent] =
    await Promise.all([
      safe(pipelineByStage(ctx, scope)),
      safe(closedInRange(ctx, scope, "won", ts(thisMonth, tz), ts(nextMonth, tz))),
      safe(closedInRange(ctx, scope, "won", ts(lastMonth, tz), ts(thisMonth, tz))),
      safe(count(base(ctx, "leads", scope).where("createdAt", ">=", ts(thisMonth, tz)))),
      safe(
        (async () => {
          const [total, converted] = await Promise.all([
            count(base(ctx, "leads", scope).where("createdAt", ">=", since90)),
            count(
              base(ctx, "leads", scope)
                .where("status", "==", "converted")
                .where("createdAt", ">=", since90),
            ),
          ]);
          return {
            converted,
            total,
            rate: total ? Math.round((converted / total) * 1000) / 10 : 0,
          };
        })(),
      ),
      safe(myDueTaskCount(ctx)),
      safe(recentActivities(ctx)),
    ]);
  return {
    pipeline,
    wonThisMonth,
    wonLastMonth,
    newLeadsThisMonth,
    conversion,
    myTasksDue,
    recent,
  };
}

/** Members: activities they logged; others: the workspace's latest (FR-DASH-001 recent 10). */
async function recentActivities(ctx: TenantContext) {
  let q = tenantCollection(ctx, "activities").where("isDeleted", "==", false);
  if (workspaceScope(ctx.role, "record.read") === "own") q = q.where("createdBy", "==", ctx.uid);
  const snap = await q.orderBy("occurredAt", "desc").limit(10).get();
  return snap.docs.map((d) => {
    const p = toPlain(d.data()) as Record<string, unknown>;
    return {
      id: d.id,
      type: String(p.type),
      subject: String(p.subject ?? ""),
      systemEvent: (p.systemEvent as string | null) ?? null,
      occurredAt: (p.occurredAt as string | null) ?? null,
      related: (p.related as Array<{ type: string; id: string; label: string }>) ?? [],
    };
  });
}

// ---- Standard reports (FR-RPT-001) ----

export async function wonLostByMonth(ctx: TenantContext, scope: Scope) {
  authorize(ctx, "report.read");
  const tz = readTenantSettings(ctx).timezone;
  const first = monthStart(dayKey(new Date(), tz));
  const months = Array.from({ length: 12 }, (_, i) => addMonths(first, i - 11));
  return Promise.all(
    months.map(async (m) => {
      const from = ts(m, tz);
      const to = ts(addMonths(m, 1), tz);
      const [won, lost] = await Promise.all([
        closedInRange(ctx, scope, "won", from, to),
        closedInRange(ctx, scope, "lost", from, to),
      ]);
      return { month: m.slice(0, 7), won: won.count, wonValue: won.sum, lost: lost.count };
    }),
  );
}

export interface Range {
  from: string;
  to: string;
}

function validRange(range: Range, tz: string) {
  if (!(range.from <= range.to) || addMonths(monthStart(range.from), 12) < monthStart(range.to)) {
    throw new ValidationError({ range: ["Choose a range of at most 12 months"] });
  }
  return { from: ts(range.from, tz), to: ts(addDays(range.to, 1), tz) };
}

export async function leadSourceConversion(ctx: TenantContext, scope: Scope, range: Range) {
  authorize(ctx, "report.read");
  const { from, to } = validRange(range, readTenantSettings(ctx).timezone);
  return Promise.all(
    LEAD_SOURCES.map(async (source) => {
      const q = base(ctx, "leads", scope).where("source", "==", source);
      const [leads, converted] = await Promise.all([
        count(q.where("createdAt", ">=", from).where("createdAt", "<", to)),
        count(
          q
            .where("status", "==", "converted")
            .where("createdAt", ">=", from)
            .where("createdAt", "<", to),
        ),
      ]);
      return {
        source,
        leads,
        converted,
        rate: leads ? Math.round((converted / leads) * 1000) / 10 : 0,
      };
    }),
  );
}

export const ACTIVITY_REPORT_TYPES = ["call", "meeting", "email", "note"] as const;

/** One count per member × type (bounded by seats); Members see only their own row. */
export interface ActivityCounts {
  uid: string;
  name: string;
  call: number;
  meeting: number;
  email: number;
  note: number;
}

export async function activitiesByUser(
  ctx: TenantContext,
  range: Range,
  members: Array<{ uid: string; name: string }>,
): Promise<ActivityCounts[]> {
  authorize(ctx, "report.read");
  const { from, to } = validRange(range, readTenantSettings(ctx).timezone);
  const people =
    workspaceScope(ctx.role, "report.read") === "own"
      ? members.filter((m) => m.uid === ctx.uid)
      : members;
  return Promise.all(
    people.map(async (m) => {
      const counts = await Promise.all(
        ACTIVITY_REPORT_TYPES.map((type) =>
          count(
            tenantCollection(ctx, "activities")
              .where("isDeleted", "==", false)
              .where("createdBy", "==", m.uid)
              .where("type", "==", type)
              .where("occurredAt", ">=", from)
              .where("occurredAt", "<", to),
          ),
        ),
      );
      return {
        uid: m.uid,
        name: m.name,
        call: counts[0]!,
        meeting: counts[1]!,
        email: counts[2]!,
        note: counts[3]!,
      };
    }),
  );
}
