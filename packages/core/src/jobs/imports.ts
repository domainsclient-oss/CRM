import "server-only";
import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { parseCsv, toCsv } from "@crm/shared/csv";
import {
  IMPORT_FIELDS,
  IMPORT_LIMITS,
  rowToInput,
  suggestMapping,
  type DuplicateMode,
  type ImportEntity,
} from "@crm/shared/import";
import { normalizeDomain, normalizeEmail } from "@crm/shared/records/normalize";
import { companyInput, contactInput, leadInput } from "@crm/shared/records/schemas";
import type { ZodType } from "zod";
import { authorize } from "../authz";
import { PlanLimitError, getEffectiveConfig } from "../config/entitlements";
import type { TenantContext } from "../contexts/tenant-context";
import { AppError, NotFoundError, ValidationError } from "../errors";
import { getDb, getPrivateBucket } from "../firebase-admin";
import { saveCompany } from "../records/companies";
import { saveContact } from "../records/contacts";
import { saveLead } from "../records/leads";
import { canActOnRecord } from "../authz";
import { iso } from "../records/plain";
import { tenantCollection } from "../repositories/base";
import { contextForJob } from "./actor";
import { auditJob } from "./exports";
import { enqueueJob, jobsRunInline, registerJobHandler, runJob } from "./runner";

// CSV import (FR-IMP-001): upload → mapping → preview → run as a resumable job (500-row chunks).
// Rows are written through the same services as the forms (validation, ownership, tags, usage,
// audit), with the requester's permissions as of the run. Bad rows are skipped and reported.

const UPLOAD_ID = /^[A-Za-z0-9_-]{16,64}$/;
const SCHEMAS: Record<ImportEntity, ZodType> = {
  contacts: contactInput,
  companies: companyInput,
  leads: leadInput,
};

const uploadPath = (tenantId: string, uploadId: string) => `imports/${tenantId}/${uploadId}.csv`;

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ValidationError({ file: ["Save the file as UTF-8 CSV"] }, "encoding");
  }
}

function parse(text: string) {
  try {
    return parseCsv(text, IMPORT_LIMITS.maxRows + 1);
  } catch {
    throw new ValidationError({ file: ["The file isn't valid CSV (check quotes)"] }, "csv");
  }
}

/** Step 1: store the upload privately and return its id + header. */
export async function storeImportUpload(ctx: TenantContext, bytes: Uint8Array) {
  authorize(ctx, "import.run");
  if (bytes.byteLength === 0) throw new ValidationError({ file: ["Choose a CSV file"] });
  if (bytes.byteLength > IMPORT_LIMITS.maxBytes) {
    throw new ValidationError({ file: ["The file is larger than 10 MB"] });
  }
  const { header, rows } = parse(decode(bytes));
  if (header.length === 0 || header.every((h) => !h))
    throw new ValidationError({ file: ["The file has no header row"] });
  if (rows.length > IMPORT_LIMITS.maxRows)
    throw new ValidationError({ file: ["The file has more than 10,000 rows"] });
  const uploadId = randomBytes(18).toString("base64url");
  await getPrivateBucket()
    .file(uploadPath(ctx.tenantId, uploadId))
    .save(Buffer.from(bytes), {
      resumable: false,
      contentType: "text/csv",
      metadata: { metadata: { uploadedBy: ctx.uid } },
    });
  return { uploadId, header, rowCount: rows.length };
}

async function loadUpload(ctx: TenantContext, uploadId: string) {
  if (!UPLOAD_ID.test(uploadId)) throw new NotFoundError();
  const file = getPrivateBucket().file(uploadPath(ctx.tenantId, uploadId));
  const [exists] = await file.exists();
  if (!exists) throw new NotFoundError();
  const [meta] = await file.getMetadata();
  // Only the uploader can continue their import.
  if ((meta.metadata as Record<string, unknown> | undefined)?.uploadedBy !== ctx.uid)
    throw new NotFoundError();
  const [body] = await file.download();
  return parse(decode(body));
}

function validateMapping(entity: ImportEntity, mapping: Array<string | null>, width: number) {
  const allowed = Object.keys(IMPORT_FIELDS[entity]);
  const used = mapping.filter((m): m is string => Boolean(m));
  if (
    mapping.length !== width ||
    used.some((m) => !allowed.includes(m)) ||
    new Set(used).size !== used.length
  ) {
    throw new ValidationError({ mapping: ["Each field can be used for one column only"] });
  }
}

function rowError(entity: ImportEntity, input: Record<string, unknown>): string | null {
  const result = SCHEMAS[entity].safeParse(input);
  if (result.success) return null;
  const issue = result.error.issues[0]!;
  return `${issue.path.join(".") || "row"}: ${issue.message}`.slice(0, 200);
}

/** Step 2: mapping suggestion + validation preview (first 50 rows; error count over all rows). */
export async function previewImport(
  ctx: TenantContext,
  uploadId: string,
  entity: ImportEntity,
  mapping: Array<string | null> | null,
) {
  authorize(ctx, "import.run");
  const { header, rows } = await loadUpload(ctx, uploadId);
  const map = mapping ?? suggestMapping(header, entity);
  validateMapping(entity, map, header.length);
  const errors = rows.map((r) => rowError(entity, rowToInput(entity, r, map)));
  return {
    header,
    mapping: map,
    rowCount: rows.length,
    errorCount: errors.filter(Boolean).length,
    preview: rows
      .slice(0, 50)
      .map((r, i) => ({ row: i + 2, cells: r.slice(0, header.length), error: errors[i] })),
  };
}

/** Step 3: queue the import (records limit checked up front — FR-IMP-001 AC5). */
export async function startImport(
  ctx: TenantContext,
  input: {
    uploadId: string;
    entity: ImportEntity;
    mapping: Array<string | null>;
    duplicateMode: DuplicateMode;
  },
) {
  authorize(ctx, "import.run");
  const { header, rows } = await loadUpload(ctx, input.uploadId);
  validateMapping(input.entity, input.mapping, header.length);
  const [config, usage] = await Promise.all([
    getEffectiveConfig(ctx),
    getDb().doc(`tenants/${ctx.tenantId}/usage/current`).get(),
  ]);
  if (rows.length > config.limits.importRowsPerJob) throw new PlanLimitError("import_rows");
  const used = (usage.get("records") as number | undefined) ?? 0;
  if (input.duplicateMode !== "update" && used + rows.length > config.limits.records) {
    throw new PlanLimitError("records");
  }
  const { jobId } = await enqueueJob(
    ctx,
    "import",
    {
      entity: input.entity,
      path: uploadPath(ctx.tenantId, input.uploadId),
      mapping: input.mapping,
      duplicateMode: input.duplicateMode,
    },
    `${input.entity} import`,
  );
  await auditJob(ctx, "import.requested", jobId, {
    entity: input.entity,
    rows: String(rows.length),
  });
  if (jobsRunInline()) await runJob(ctx.tenantId, jobId);
  return { jobId };
}

/** Duplicate lookup: same rules as the form warnings (contacts by email, companies by domain). */
async function findExisting(
  ctx: TenantContext,
  entity: ImportEntity,
  input: Record<string, unknown>,
) {
  let query;
  if (entity === "contacts" && input.email) {
    query = tenantCollection(ctx, "contacts")
      .where("isDeleted", "==", false)
      .where("emailNormalized", "==", normalizeEmail(String(input.email)));
  } else if (entity === "companies" && input.domain) {
    const domain = normalizeDomain(String(input.domain));
    if (!domain) return null;
    query = tenantCollection(ctx, "companies")
      .where("isDeleted", "==", false)
      .where("domainNormalized", "==", domain);
  } else return null;
  const doc = (await query.limit(1).get()).docs[0];
  return doc ? { id: doc.id, data: doc.data() } : null;
}

const SAVE = { contacts: saveContact, companies: saveCompany, leads: saveLead } as const;

registerJobHandler("import", async (job) => {
  const ctx = await contextForJob(job.tenantId, job.job.requestedBy, job.jobId);
  authorize(ctx, "import.run");
  const p = job.job.params as {
    entity: ImportEntity;
    path: string;
    mapping: Array<string | null>;
    duplicateMode: DuplicateMode;
  };
  if (!p.path.startsWith(`imports/${job.tenantId}/`)) throw new Error("foreign_path");
  const [body] = await getPrivateBucket().file(p.path).download();
  const { rows } = parse(decode(body));
  const errorRows = (
    (job.job as unknown as { errorRows?: Array<{ row: number; reason: string }> }).errorRows ?? []
  ).slice();
  let { processed, failed } = job.job.progress;
  for (let start = job.job.cursor; start < rows.length; start += IMPORT_LIMITS.chunkSize) {
    const chunk = rows.slice(start, start + IMPORT_LIMITS.chunkSize);
    for (const [offset, row] of chunk.entries()) {
      const rowNumber = start + offset + 2; // header is row 1
      const raw = rowToInput(p.entity, row, p.mapping);
      const parsed = SCHEMAS[p.entity].safeParse(raw);
      try {
        if (!parsed.success) throw new ValidationError({}, rowError(p.entity, raw) ?? "invalid");
        const existing =
          p.duplicateMode === "create" ? null : await findExisting(ctx, p.entity, raw);
        if (existing && p.duplicateMode === "skip")
          throw new AppError("CONFLICT", "duplicate (skipped)");
        if (
          existing &&
          !canActOnRecord(ctx, "record.update", { ownerUid: String(existing.data.ownerUid) })
        ) {
          throw new AppError("CONFLICT", "duplicate owned by another user");
        }
        const target = existing
          ? { id: existing.id, expectedUpdatedAt: iso(existing.data.updatedAt) ?? "" }
          : null;
        await (
          SAVE[p.entity] as (c: TenantContext, t: typeof target, i: unknown) => Promise<unknown>
        )(ctx, target, parsed.data);
      } catch (error) {
        failed++;
        const reason =
          error instanceof AppError
            ? error.code === "VALIDATION"
              ? String(error.message)
              : `${error.code.toLowerCase()}: ${error.message}`
            : "error";
        if (errorRows.length < 1000)
          errorRows.push({ row: rowNumber, reason: reason.slice(0, 200) });
      }
      processed++;
    }
    // Resume point after each chunk (idempotency per chunk; a retried chunk re-validates duplicates).
    await job.ref.update({
      errorRows,
      cursor: start + chunk.length,
      progress: { total: rows.length, processed, failed },
    });
    job.job.cursor = start + chunk.length;
  }
  const files = [];
  if (errorRows.length > 0) {
    const path = `imports/${job.tenantId}/${job.jobId}-errors.csv`;
    await getPrivateBucket()
      .file(path)
      .save(toCsv([["row", "reason"], ...errorRows.map((e) => [e.row, e.reason])]), {
        resumable: false,
        contentType: "text/csv; charset=utf-8",
      });
    files.push({ name: "errors.csv", path, contentType: "text/csv; charset=utf-8" });
  }
  await job.ref.update({ completedRowsAt: FieldValue.serverTimestamp() });
  return {
    status: failed === 0 ? "succeeded" : failed < rows.length ? "partial" : "failed",
    files,
  };
});
