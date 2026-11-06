import "server-only";
import { toCsv } from "@crm/shared/csv";
import { parseListParams, type ListEntity } from "@crm/shared/records/list-specs";
import { audit } from "../audit";
import { authorize } from "../authz";
import type { TenantContext } from "../contexts/tenant-context";
import { getDb, getPrivateBucket } from "../firebase-admin";
import { getPipeline } from "../records/deals";
import { buildListQuery, orderedListQuery } from "../records/list";
import { TENANT_COLLECTIONS } from "../repositories/base";
import { contextForJob } from "./actor";
import { csvHeader, csvRows, type Lookups } from "./csv-columns";
import { enqueueJob, registerJobHandler, runJob, jobsRunInline } from "./runner";

// List CSV export (FR-IMP-002) and full tenant export (FR-TEN-007). Both run as jobs, write to the
// private bucket under exports/{tenantId}/{jobId}/, and are downloaded through the authenticated
// /api/files route. Only the requesting tenant's data is ever read (TC-TEN-006).

export const MAX_EXPORT_ROWS = 50_000;
const PAGE = 500;

async function lookups(ctx: TenantContext): Promise<Lookups> {
  const [members, pipeline] = await Promise.all([
    getDb().collection(`tenants/${ctx.tenantId}/members`).get(),
    getPipeline(ctx),
  ]);
  return {
    members: Object.fromEntries(
      members.docs.map((d) => [d.id, String(d.get("displayName") ?? d.get("email") ?? "")]),
    ),
    stages: Object.fromEntries(pipeline.stages.map((s) => [s.id, s.name])),
  };
}

async function save(path: string, body: string, contentType: string) {
  await getPrivateBucket().file(path).save(body, { resumable: false, contentType });
}

/** Queue a list export with the current (allowlisted) filter and sort. */
export async function requestListExport(
  ctx: TenantContext,
  entity: ListEntity,
  query: Record<string, string | undefined>,
) {
  authorize(ctx, "record.export");
  const params = parseListParams(entity, query);
  const description = params.filter ? `${params.filter.spec.id}=${params.filter.value}` : "all";
  const { jobId } = await enqueueJob(
    ctx,
    "export",
    {
      entity,
      sort: params.sort.id,
      filter: params.filter?.spec.id ?? null,
      value: params.filter?.value ?? null,
    },
    `${entity} export`,
  );
  await auditJob(ctx, "export.requested", jobId, { entity, filter: description.slice(0, 80) });
  if (jobsRunInline()) await runJob(ctx.tenantId, jobId);
  return { jobId };
}

export async function requestTenantExport(ctx: TenantContext) {
  authorize(ctx, "tenant.export");
  const { jobId } = await enqueueJob(ctx, "tenantExport", {}, "Workspace export");
  await auditJob(ctx, "export.requested", jobId, { entity: "tenant" });
  if (jobsRunInline()) await runJob(ctx.tenantId, jobId);
  return { jobId };
}

async function auditJob(
  ctx: TenantContext,
  action: "export.requested" | "import.requested",
  jobId: string,
  meta: Record<string, string>,
) {
  const batch = getDb().batch();
  audit(
    batch,
    { tenantId: ctx.tenantId },
    {
      action,
      actor: { type: "user", uid: ctx.uid },
      target: { type: "job", id: jobId },
      meta,
      requestId: ctx.requestId,
    },
  );
  await batch.commit();
}
export { auditJob };

registerJobHandler("export", async (job) => {
  const ctx = await contextForJob(job.tenantId, job.job.requestedBy, job.jobId);
  authorize(ctx, "record.export"); // still allowed when the job runs
  const entity = job.job.params.entity as ListEntity;
  const params = parseListParams(entity, {
    sort: String(job.job.params.sort ?? ""),
    ...(job.job.params.filter
      ? { filter: String(job.job.params.filter), value: String(job.job.params.value) }
      : {}),
  });
  const built = buildListQuery(ctx, entity, params);
  const look = await lookups(ctx);
  const rows: unknown[][] = [csvHeader(entity)];
  if (built) {
    let query = orderedListQuery(built.filtered, params).limit(PAGE);
    for (;;) {
      const snap = await query.get();
      rows.push(
        ...csvRows(
          entity,
          snap.docs.map((d) => ({ ...d.data(), id: d.id })),
          look,
        ),
      );
      await job.checkpoint({
        progress: { total: rows.length - 1, processed: rows.length - 1, failed: 0 },
      });
      const last = snap.docs.at(-1);
      if (snap.size < PAGE || !last || rows.length - 1 >= MAX_EXPORT_ROWS) break;
      query = orderedListQuery(built.filtered, params)
        .startAfter(last.get(params.sort.field), last.id)
        .limit(PAGE);
    }
  }
  const path = `exports/${job.tenantId}/${job.jobId}/${entity}.csv`;
  await save(path, toCsv(rows.slice(0, MAX_EXPORT_ROWS + 1)), "text/csv; charset=utf-8");
  return {
    status: "succeeded",
    files: [{ name: `${entity}.csv`, path, contentType: "text/csv; charset=utf-8" }],
  };
});

const CSV_ENTITIES = ["contacts", "companies", "leads", "deals", "tasks"] as const;
/** Tokens and other secrets never leave in exports. */
const EXCLUDED = new Set(["invitations", "jobs", "billing", "auditLogs"]);

registerJobHandler("tenantExport", async (job) => {
  const ctx = await contextForJob(job.tenantId, job.job.requestedBy, job.jobId);
  authorize(ctx, "tenant.export");
  const base = getDb().doc(`tenants/${job.tenantId}`);
  const lines: string[] = [
    JSON.stringify({ collection: "tenant", id: job.tenantId, data: (await base.get()).data() }),
  ];
  const csvDocs: Record<string, FirebaseFirestore.DocumentData[]> = {};
  let processed = 0;
  for (const collection of TENANT_COLLECTIONS) {
    if (EXCLUDED.has(collection)) continue;
    let query = base.collection(collection).orderBy("__name__").limit(PAGE);
    for (;;) {
      const snap = await query.get();
      for (const d of snap.docs) {
        lines.push(JSON.stringify({ collection, id: d.id, data: d.data() }));
        if (
          (CSV_ENTITIES as readonly string[]).includes(collection) &&
          d.get("isDeleted") !== true
        ) {
          (csvDocs[collection] ??= []).push({ ...d.data(), id: d.id });
        }
      }
      processed += snap.size;
      await job.checkpoint({ progress: { total: processed, processed, failed: 0 } });
      const last = snap.docs.at(-1);
      if (snap.size < PAGE || !last) break;
      query = base.collection(collection).orderBy("__name__").startAfter(last.id).limit(PAGE);
    }
  }
  const dir = `exports/${job.tenantId}/${job.jobId}`;
  const files = [
    {
      name: "workspace.jsonl",
      path: `${dir}/workspace.jsonl`,
      contentType: "application/x-ndjson",
    },
  ];
  await save(files[0]!.path, `${lines.join("\n")}\n`, files[0]!.contentType);
  const look = await lookups(ctx);
  for (const entity of CSV_ENTITIES) {
    const path = `${dir}/${entity}.csv`;
    await save(
      path,
      toCsv([csvHeader(entity), ...csvRows(entity, csvDocs[entity] ?? [], look)]),
      "text/csv; charset=utf-8",
    );
    files.push({ name: `${entity}.csv`, path, contentType: "text/csv; charset=utf-8" });
  }
  return { status: "succeeded", files };
});
