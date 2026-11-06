import "server-only";
import { FieldPath, type DocumentData, type Query } from "firebase-admin/firestore";
import type { ListEntity, ListParams } from "@crm/shared/records/list-specs";
import { workspaceScope } from "@crm/shared/permissions";
import type { TenantContext } from "../contexts/tenant-context";
import { listShapeId } from "../query-shapes";
import { scopedQuery } from "../repositories/base";
import { decodeCursor, encodeCursor } from "./cursor";
import { toPlain } from "./plain";

// List infrastructure (T-04-01, FR-SRCH-002): queries are built ONLY from the allowlisted list
// specs on top of scopedQuery (soft-delete + Member own-scope), ordered by the sort field plus
// document ID (stable under concurrent inserts), paginated with signed cursors.

export interface ListPage<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
  /** True when the collection has no visible records at all (vs. no matches for a filter). */
  emptyCollection: boolean;
}

function scopeOf(ctx: TenantContext): "all" | "own" {
  return workspaceScope(ctx.role, "record.read") === "own" ? "own" : "all";
}

/**
 * The filtered (unordered) query for a list view and its shape id, or null when the filter can
 * match nothing for this actor. Shared by list pages and CSV exports.
 */
export function buildListQuery(
  ctx: TenantContext,
  entity: ListEntity,
  params: Pick<ListParams, "filter" | "sort">,
): { base: Query<DocumentData>; filtered: Query<DocumentData>; shapeId: string } | null {
  const scope = scopeOf(ctx);
  const base = scopedQuery(ctx, entity);
  let query: Query<DocumentData> = base;
  let filterId: string | null = params.filter?.spec.id ?? null;
  if (params.filter) {
    const { spec: filter, value } = params.filter;
    if (scope === "own" && filter.kind === "member") {
      // Members already see only their own records; another owner matches nothing.
      if (value !== ctx.uid) return null;
      filterId = null;
    } else if (filter.kind === "tag") {
      query = query.where(filter.field, "array-contains", value);
    } else {
      query = query.where(filter.field, "==", value);
    }
  }
  return { base, filtered: query, shapeId: listShapeId(entity, scope, filterId, params.sort.id) };
}

export function orderedListQuery(query: Query<DocumentData>, params: Pick<ListParams, "sort">) {
  const direction = params.sort.direction;
  return query.orderBy(params.sort.field, direction).orderBy(FieldPath.documentId(), direction);
}

export async function listRecords<T = Record<string, unknown>>(
  ctx: TenantContext,
  entity: ListEntity,
  params: ListParams,
): Promise<ListPage<T>> {
  const built = buildListQuery(ctx, entity, params);
  if (!built) return { items: [], nextCursor: null, total: 0, emptyCollection: false };
  const { base, filtered, shapeId } = built;
  let query = orderedListQuery(filtered, params);
  const after = decodeCursor(shapeId, params.cursor);
  if (after) query = query.startAfter(after[0], after[1]);

  const [snap, total] = await Promise.all([
    query.limit(params.pageSize + 1).get(),
    filtered.count().get(),
  ]);
  const docs = snap.docs.slice(0, params.pageSize);
  const last = docs.at(-1);
  const nextCursor =
    snap.docs.length > params.pageSize && last
      ? encodeCursor(shapeId, last.get(params.sort.field), last.id)
      : null;
  const totalCount = total.data().count;
  const emptyCollection =
    totalCount === 0 && (params.filter ? (await base.limit(1).get()).empty : true);

  return {
    items: docs.map((d) => ({ ...(toPlain(d.data()) as T), id: d.id })),
    nextCursor,
    total: totalCount,
    emptyCollection,
  };
}
