import "server-only";
import { FieldValue, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { workspaceScope } from "@crm/shared/permissions";
import type { TenantContext } from "../contexts/tenant-context";
import { NotFoundError } from "../errors";
import { getDb } from "../firebase-admin";
import { logger } from "../logger";
import { notify } from "../notifications";
import { toPlain } from "../records/plain";
import { assertSafeId, tenantCollection } from "../repositories/base";
import { getServerEnv } from "../server-env";

// Background jobs (ADR-008, requirements/02 §11): a job document under the tenant is the unit of
// work. Server Actions only create the document after authorization; the body runs either inline
// (local/test) or in Cloud Functions (hosted), and is idempotent — it records progress and can be
// resumed. Tenant IDs come from the job's path, never from its params.

export type JobType =
  "import" | "export" | "tenantExport" | "searchBackfill" | "leadActivityRelink";
export type JobStatus = "queued" | "running" | "succeeded" | "partial" | "failed";

export interface JobDoc {
  type: JobType;
  status: JobStatus;
  params: Record<string, unknown>;
  progress: { total: number; processed: number; failed: number };
  /** Next chunk to process (resume point). */
  cursor: number;
  files: Array<{ name: string; path: string; contentType: string }>;
  requestedBy: string;
  error: string | null;
  label: string;
}

export interface JobContext {
  tenantId: string;
  jobId: string;
  ref: DocumentReference;
  job: JobDoc;
  /** Persist progress (and the resume point) after each chunk. */
  checkpoint(patch: Partial<Pick<JobDoc, "progress" | "cursor" | "files">>): Promise<void>;
}

type Handler = (
  job: JobContext,
) => Promise<{ status: Exclude<JobStatus, "queued" | "running">; files?: JobDoc["files"] }>;
const handlers = new Map<JobType, Handler>();

export function registerJobHandler(type: JobType, handler: Handler): void {
  handlers.set(type, handler);
}

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Download window for generated files (FR-IMP-002: 24 h). */
export const FILE_TTL_MS = 24 * 60 * 60 * 1000;

export async function enqueueJob(
  ctx: Pick<TenantContext, "tenantId" | "uid">,
  type: JobType,
  params: Record<string, unknown>,
  label: string,
): Promise<{ jobId: string }> {
  const ref = tenantCollection(ctx, "jobs").doc();
  await ref.create({
    type,
    status: "queued",
    params,
    label: label.slice(0, 120),
    progress: { total: 0, processed: 0, failed: 0 },
    cursor: 0,
    files: [],
    requestedBy: ctx.uid,
    error: null,
    createdAt: FieldValue.serverTimestamp(),
    finishedAt: null,
    expireAt: Timestamp.fromMillis(Date.now() + TTL_MS),
  });
  return { jobId: ref.id };
}

export function jobsRunInline(): boolean {
  const env = getServerEnv();
  return (
    (env.JOBS_MODE ??
      (["staging", "production"].includes(env.APP_ENV) ? "functions" : "inline")) === "inline"
  );
}

/**
 * Run (or resume) one job. Safe to call repeatedly and concurrently: the claim transaction lets
 * only one runner move it from queued → running; a crashed runner's job can be resumed by calling
 * again with `resume: true` (scheduler), which continues from the stored cursor.
 */
export async function runJob(
  tenantId: string,
  jobId: string,
  opts: { resume?: boolean } = {},
): Promise<JobStatus> {
  assertSafeId(tenantId);
  assertSafeId(jobId);
  const ref = getDb().doc(`tenants/${tenantId}/jobs/${jobId}`);
  const claimed = await getDb().runTransaction(async (tx) => {
    const job = (await tx.get(ref)).data() as JobDoc | undefined;
    if (!job) return null;
    if (job.status === "queued" || (opts.resume && job.status === "running")) {
      tx.update(ref, { status: "running", startedAt: FieldValue.serverTimestamp() });
      return job;
    }
    return null;
  });
  if (!claimed) return ((await ref.get()).get("status") as JobStatus | undefined) ?? "failed";
  const handler = handlers.get(claimed.type);
  let status: JobStatus = "failed";
  let files: JobDoc["files"] = claimed.files ?? [];
  try {
    if (!handler) throw new Error(`no_handler:${claimed.type}`);
    const result = await handler({
      tenantId,
      jobId,
      ref,
      job: claimed,
      checkpoint: async (patch) => {
        await ref.update(patch);
        Object.assign(claimed, patch);
      },
    });
    status = result.status;
    files = result.files ?? files;
    await ref.update({
      status,
      files,
      finishedAt: FieldValue.serverTimestamp(),
      filesExpireAt: Timestamp.fromMillis(Date.now() + FILE_TTL_MS),
    });
  } catch (error) {
    logger.error("job_failed", {
      tenantId,
      jobId,
      type: claimed.type,
      error: error instanceof Error ? error.message : "x",
    });
    await ref.update({
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      finishedAt: FieldValue.serverTimestamp(),
    });
  }
  if (["import", "export", "tenantExport"].includes(claimed.type)) {
    await notify({
      tenantId,
      recipientUid: claimed.requestedBy,
      type: "job_finished",
      title: claimed.label,
      link: "/settings/import",
    });
  }
  return status;
}

export interface JobView {
  id: string;
  type: JobType;
  status: JobStatus;
  label: string;
  progress: JobDoc["progress"];
  files: Array<{ name: string }>;
  error: string | null;
  createdAt: string | null;
  downloadable: boolean;
}

function canSeeJob(ctx: TenantContext, job: JobDoc): boolean {
  return job.requestedBy === ctx.uid || workspaceScope(ctx.role, "settings.manage") !== null;
}

export async function listJobs(ctx: TenantContext): Promise<JobView[]> {
  const snap = await tenantCollection(ctx, "jobs").orderBy("createdAt", "desc").limit(20).get();
  return snap.docs
    .filter((d) => canSeeJob(ctx, d.data() as JobDoc))
    .map((d) => jobView(d.id, d.data()));
}

function jobView(id: string, data: FirebaseFirestore.DocumentData): JobView {
  const p = toPlain(data) as Record<string, unknown>;
  const expires = data.filesExpireAt as Timestamp | undefined;
  return {
    id,
    type: data.type,
    status: data.status,
    label: String(data.label ?? ""),
    progress: data.progress,
    files: ((data.files as JobDoc["files"]) ?? []).map((f) => ({ name: f.name })),
    error: (data.error as string | null) ?? null,
    createdAt: (p.createdAt as string | null) ?? null,
    downloadable: !expires || expires.toMillis() > Date.now(),
  };
}

export async function getJob(ctx: TenantContext, jobId: string): Promise<JobView> {
  assertSafeId(jobId);
  const data = (await tenantCollection(ctx, "jobs").doc(jobId).get()).data() as JobDoc | undefined;
  if (!data || !canSeeJob(ctx, data)) throw new NotFoundError();
  return jobView(jobId, data);
}

/** Authorized file lookup for the download route (requester or workspace admins; 24 h window). */
export async function getJobFile(
  ctx: TenantContext,
  jobId: string,
  name: string,
): Promise<{ path: string; contentType: string; name: string }> {
  assertSafeId(jobId);
  const snap = await tenantCollection(ctx, "jobs").doc(jobId).get();
  const data = snap.data() as (JobDoc & { filesExpireAt?: Timestamp }) | undefined;
  if (!data || !canSeeJob(ctx, data)) throw new NotFoundError();
  if (data.filesExpireAt && data.filesExpireAt.toMillis() < Date.now())
    throw new NotFoundError("expired");
  const file = data.files?.find((f) => f.name === name);
  const inTenant = (p: string) =>
    p.startsWith(`exports/${ctx.tenantId}/`) || p.startsWith(`imports/${ctx.tenantId}/`);
  if (!file || !inTenant(file.path)) {
    throw new NotFoundError();
  }
  return file;
}
