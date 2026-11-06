import {
  DEAL_STATUSES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LIFECYCLE_STAGES,
  RELATED_TYPES,
  TASK_STATUSES,
} from "./schemas";
import { TAG_PATTERN, normalizeTag } from "./normalize";

// Allowlisted list filters and sorts per entity (FR-SRCH-002, requirements/03 §8). The UI offers
// only these; the server builds queries only from these; query shapes and composite indexes are
// derived from these. At most ONE filter is active at a time (phase-4-plan decision 1).

export const LIST_ENTITIES = ["companies", "contacts", "leads", "deals", "tasks"] as const;
export type ListEntity = (typeof LIST_ENTITIES)[number];

export interface SortSpec {
  id: string;
  field: string;
  direction: "asc" | "desc";
}

export type FilterKind = "member" | "enum" | "id" | "tag";
export interface FilterSpec {
  id: string;
  field: string;
  kind: FilterKind;
  values?: readonly string[];
}

export interface ListSpec {
  /** Field holding the owner (Member own-scope, ADR-023). */
  ownerField: string;
  sorts: SortSpec[];
  filters: FilterSpec[];
}

const updated: SortSpec = { id: "updated", field: "updatedAt", direction: "desc" };
const tag: FilterSpec = { id: "tag", field: "tags", kind: "tag" };
const owner: FilterSpec = { id: "owner", field: "ownerUid", kind: "member" };

export const LIST_SPECS: Record<ListEntity, ListSpec> = {
  companies: {
    ownerField: "ownerUid",
    sorts: [updated, { id: "name", field: "nameLower", direction: "asc" }],
    filters: [owner, tag],
  },
  contacts: {
    ownerField: "ownerUid",
    sorts: [updated, { id: "name", field: "fullNameLower", direction: "asc" }],
    filters: [
      owner,
      { id: "stage", field: "lifecycleStage", kind: "enum", values: LIFECYCLE_STAGES },
      { id: "company", field: "companyId", kind: "id" },
      tag,
    ],
  },
  leads: {
    ownerField: "ownerUid",
    sorts: [
      { id: "created", field: "createdAt", direction: "desc" },
      { id: "name", field: "fullNameLower", direction: "asc" },
    ],
    filters: [
      owner,
      { id: "status", field: "status", kind: "enum", values: LEAD_STATUSES },
      { id: "source", field: "source", kind: "enum", values: LEAD_SOURCES },
      tag,
    ],
  },
  deals: {
    ownerField: "ownerUid",
    sorts: [
      updated,
      { id: "close", field: "expectedCloseDate", direction: "asc" },
      { id: "name", field: "nameLower", direction: "asc" },
    ],
    filters: [
      owner,
      { id: "status", field: "status", kind: "enum", values: DEAL_STATUSES },
      { id: "stage", field: "stageId", kind: "id" },
      { id: "company", field: "companyId", kind: "id" },
      { id: "contact", field: "primaryContactId", kind: "id" },
      tag,
    ],
  },
  tasks: {
    ownerField: "assigneeUid",
    sorts: [{ id: "due", field: "dueAt", direction: "asc" }, updated],
    filters: [
      { id: "assignee", field: "assigneeUid", kind: "member" },
      { id: "status", field: "status", kind: "enum", values: TASK_STATUSES },
      { id: "related", field: "related.id", kind: "id" },
    ],
  },
};

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;
export const MAX_TRAIL = 20;

export interface ListParams {
  sort: SortSpec;
  filter: { spec: FilterSpec; value: string } | null;
  cursor: string | null;
  /** Cursors of the previous pages (oldest first), for "Previous" links. */
  trail: string[];
  pageSize: number;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const CURSOR = /^[A-Za-z0-9_-]{10,1024}\.[A-Za-z0-9_-]{20,64}$/;

export function validFilterValue(spec: FilterSpec, raw: string): string | null {
  switch (spec.kind) {
    case "member":
    case "id":
      return ID.test(raw) ? raw : null;
    case "enum":
      return spec.values?.includes(raw) ? raw : null;
    case "tag": {
      const value = normalizeTag(raw);
      return value.length >= 1 && value.length <= 32 && TAG_PATTERN.test(value) ? value : null;
    }
  }
}

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * URL search params → validated list params. Anything unknown or malformed falls back to the
 * defaults (never an error page): the URL is user-editable.
 */
export function parseListParams(entity: ListEntity, params: Params): ListParams {
  const spec = LIST_SPECS[entity];
  const sort = spec.sorts.find((s) => s.id === first(params.sort)) ?? spec.sorts[0]!;
  let filter: ListParams["filter"] = null;
  const filterId = first(params.filter);
  const filterSpec = spec.filters.find((f) => f.id === filterId);
  const rawValue = first(params.value);
  if (filterSpec && rawValue) {
    const value = validFilterValue(filterSpec, rawValue);
    if (value) filter = { spec: filterSpec, value };
  }
  const cursorRaw = first(params.cursor);
  const cursor = cursorRaw && CURSOR.test(cursorRaw) ? cursorRaw : null;
  const trailRaw = first(params.trail);
  const trail =
    cursor && trailRaw
      ? trailRaw
          .split("~")
          .filter((c) => c === "0" || CURSOR.test(c))
          .slice(-MAX_TRAIL)
      : [];
  const sizeRaw = Number(first(params.size));
  const pageSize =
    Number.isInteger(sizeRaw) && sizeRaw >= 1 && sizeRaw <= PAGE_SIZE_MAX
      ? sizeRaw
      : PAGE_SIZE_DEFAULT;
  return { sort, filter, cursor, trail, pageSize };
}

/** Query string for a list URL (only non-default values). "0" in a trail = first page. */
export function listQuery(
  entity: ListEntity,
  p: { sort?: string; filter?: string; value?: string; cursor?: string | null; trail?: string[] },
): string {
  const spec = LIST_SPECS[entity];
  const q = new URLSearchParams();
  if (p.sort && p.sort !== spec.sorts[0]!.id) q.set("sort", p.sort);
  if (p.filter && p.value) {
    q.set("filter", p.filter);
    q.set("value", p.value);
  }
  if (p.cursor) {
    q.set("cursor", p.cursor);
    if (p.trail && p.trail.length > 0) q.set("trail", p.trail.slice(-MAX_TRAIL).join("~"));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const RELATED_COLLECTION: Record<(typeof RELATED_TYPES)[number], ListEntity | "leads"> = {
  company: "companies",
  contact: "contacts",
  lead: "leads",
  deal: "deals",
};
