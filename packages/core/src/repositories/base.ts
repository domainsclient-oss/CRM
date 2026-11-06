import "server-only";
import type { CollectionReference, DocumentData, Query } from "firebase-admin/firestore";
import { workspaceScope } from "@crm/shared/permissions";
import { NotFoundError } from "../errors";
import { getDb } from "../firebase-admin";
import { logger } from "../logger";

// Tenant-scoped data access (requirements/02 §5, ADR-004, ADR-023). The ONLY place
// that builds tenant document paths. Paths come from the server context, never input.
// Members (record.read = "own") are restricted to records they own on every read path.

export const TENANT_COLLECTIONS = [
  "members",
  "invitations",
  "companies",
  "contacts",
  "leads",
  "deals",
  "pipelines",
  "tasks",
  "activities",
  "notifications",
  "tagDefinitions",
  "emailTemplates",
  "jobs",
  "usage",
  "billing",
  "billingHistory",
  "auditLogs",
] as const;
export type TenantCollection = (typeof TENANT_COLLECTIONS)[number];

/** CRM record collections subject to Member own-only visibility, and their owner field. */
export const OWNED_COLLECTIONS = {
  companies: "ownerUid",
  contacts: "ownerUid",
  leads: "ownerUid",
  deals: "ownerUid",
  tasks: "assigneeUid",
} as const satisfies Partial<Record<TenantCollection, string>>;
export type OwnedCollection = keyof typeof OWNED_COLLECTIONS;

/** Minimal context the repository needs; satisfied by TenantContext. */
export interface RepoContext {
  tenantId: string;
  uid: string;
  role: Parameters<typeof workspaceScope>[0];
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id)) throw new NotFoundError("unsafe_id");
}

export function tenantCollection(
  ctx: Pick<RepoContext, "tenantId">,
  name: TenantCollection,
): CollectionReference<DocumentData> {
  assertSafeId(ctx.tenantId);
  return getDb().collection("tenants").doc(ctx.tenantId).collection(name);
}

function readScope(ctx: RepoContext) {
  return workspaceScope(ctx.role, "record.read");
}

/**
 * Base query for listing/searching/aggregating owned records. Excludes soft-deleted
 * records and, for "own" scope, adds the owner filter. Every list/search/report path
 * must start here (ADR-023).
 */
export function scopedQuery(ctx: RepoContext, name: OwnedCollection): Query<DocumentData> {
  const scope = readScope(ctx);
  if (!scope) throw new NotFoundError("no_read_access");
  let query: Query<DocumentData> = tenantCollection(ctx, name).where("isDeleted", "==", false);
  if (scope === "own") query = query.where(OWNED_COLLECTIONS[name], "==", ctx.uid);
  return query;
}

/** May this context read this record? (pure; exported for tests and services) */
export function canReadRecord(
  ctx: RepoContext,
  name: TenantCollection,
  record: DocumentData,
): boolean {
  if (!(name in OWNED_COLLECTIONS)) return true;
  const scope = readScope(ctx);
  if (scope === "all") return true;
  if (scope === "own") return record[OWNED_COLLECTIONS[name as OwnedCollection]] === ctx.uid;
  return false;
}

/**
 * Load one document by ID. Missing, soft-deleted, foreign-tenant, or not-visible
 * records all raise NotFound — callers can't distinguish them (no existence oracle).
 */
export async function getById<T extends DocumentData>(
  ctx: RepoContext,
  name: TenantCollection,
  id: string,
): Promise<T & { id: string }> {
  assertSafeId(id);
  const snap = await tenantCollection(ctx, name).doc(id).get();
  const data = snap.data();
  if (!data || data.isDeleted === true) throw new NotFoundError();
  if ("tenantId" in data && data.tenantId !== ctx.tenantId) {
    logger.error("tenant_mismatch", { tenantId: ctx.tenantId, collection: name, id });
    throw new NotFoundError();
  }
  if (!canReadRecord(ctx, name, data)) throw new NotFoundError();
  return { ...(data as T), id: snap.id };
}
