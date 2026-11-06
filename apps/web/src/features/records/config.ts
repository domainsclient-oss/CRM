import { t, type MessageKey } from "@crm/shared/i18n";
import type { ListEntity } from "@crm/shared/records/list-specs";
import {
  INDUSTRIES,
  LEAD_SOURCES,
  LIFECYCLE_STAGES,
  EDITABLE_LEAD_STATUSES,
  SIZE_BANDS,
  TASK_PRIORITIES,
} from "@crm/shared/records/schemas";

// Per-entity UI configuration (T-04-02..06): which fields a form shows and which columns a list
// shows. Isomorphic (no server imports). Validation lives in @crm/shared/records/schemas.

export type RecordTypeName = "company" | "contact" | "lead" | "deal" | "task";

export const TYPE_OF: Record<ListEntity, RecordTypeName> = {
  companies: "company",
  contacts: "contact",
  leads: "lead",
  deals: "deal",
  tasks: "task",
};

export const ENTITY_OF: Record<RecordTypeName, ListEntity> = {
  company: "companies",
  contact: "contacts",
  lead: "leads",
  deal: "deals",
  task: "tasks",
};

export function isListEntity(value: string): value is ListEntity {
  return value in TYPE_OF;
}

export type FieldSpec =
  | {
      name: string;
      kind: "text" | "email" | "url" | "tel";
      required?: boolean;
      autoComplete?: string;
      maxLength?: number;
    }
  | { name: string; kind: "textarea"; maxLength: number }
  | {
      name: string;
      kind: "select";
      options: readonly string[];
      labelPrefix: string;
      allowEmpty?: boolean;
    }
  | { name: string; kind: "money" | "date" | "time" | "checkbox" | "tags" | "address" | "phones" }
  | { name: string; kind: "number"; min: number; max: number }
  | { name: string; kind: "reference"; collection: "companies" | "contacts" }
  | { name: string; kind: "member" | "stage" | "related" };

const owner: FieldSpec = { name: "ownerUid", kind: "member" };
const tags: FieldSpec = { name: "tags", kind: "tags" };

export const FORM_FIELDS: Record<ListEntity, FieldSpec[]> = {
  companies: [
    { name: "name", kind: "text", required: true, maxLength: 120, autoComplete: "organization" },
    { name: "domain", kind: "text", maxLength: 253 },
    { name: "website", kind: "url", maxLength: 2048 },
    { name: "phone", kind: "tel", maxLength: 32 },
    {
      name: "industry",
      kind: "select",
      options: INDUSTRIES,
      labelPrefix: "industry",
      allowEmpty: true,
    },
    { name: "sizeBand", kind: "select", options: SIZE_BANDS, labelPrefix: "", allowEmpty: true },
    owner,
    tags,
    { name: "address", kind: "address" },
    { name: "description", kind: "textarea", maxLength: 2000 },
  ],
  contacts: [
    { name: "firstName", kind: "text", required: true, maxLength: 80, autoComplete: "off" },
    { name: "lastName", kind: "text", maxLength: 80, autoComplete: "off" },
    { name: "email", kind: "email", maxLength: 254, autoComplete: "off" },
    { name: "phones", kind: "phones" },
    { name: "jobTitle", kind: "text", maxLength: 120 },
    { name: "companyId", kind: "reference", collection: "companies" },
    { name: "lifecycleStage", kind: "select", options: LIFECYCLE_STAGES, labelPrefix: "stage" },
    {
      name: "leadSource",
      kind: "select",
      options: LEAD_SOURCES,
      labelPrefix: "source",
      allowEmpty: true,
    },
    owner,
    tags,
    { name: "doNotContact", kind: "checkbox" },
    { name: "address", kind: "address" },
    { name: "notes", kind: "textarea", maxLength: 2000 },
  ],
  leads: [
    { name: "firstName", kind: "text", required: true, maxLength: 80, autoComplete: "off" },
    { name: "lastName", kind: "text", maxLength: 80, autoComplete: "off" },
    { name: "email", kind: "email", maxLength: 254, autoComplete: "off" },
    { name: "phone", kind: "tel", maxLength: 32 },
    { name: "companyName", kind: "text", maxLength: 120 },
    { name: "jobTitle", kind: "text", maxLength: 120 },
    { name: "source", kind: "select", options: LEAD_SOURCES, labelPrefix: "source" },
    { name: "status", kind: "select", options: EDITABLE_LEAD_STATUSES, labelPrefix: "leadStatus" },
    { name: "estimatedValue", kind: "money" },
    owner,
    tags,
    { name: "notes", kind: "textarea", maxLength: 2000 },
  ],
  deals: [
    { name: "name", kind: "text", required: true, maxLength: 120 },
    { name: "amount", kind: "money" },
    { name: "stageId", kind: "stage" },
    { name: "probability", kind: "number", min: 0, max: 100 },
    { name: "expectedCloseDate", kind: "date" },
    { name: "primaryContactId", kind: "reference", collection: "contacts" },
    { name: "companyId", kind: "reference", collection: "companies" },
    owner,
    tags,
  ],
  tasks: [
    { name: "title", kind: "text", required: true, maxLength: 200 },
    { name: "dueDate", kind: "date" },
    { name: "dueTime", kind: "time" },
    { name: "priority", kind: "select", options: TASK_PRIORITIES, labelPrefix: "priority" },
    { name: "assigneeUid", kind: "member" },
    { name: "related", kind: "related" },
    { name: "description", kind: "textarea", maxLength: 2000 },
  ],
};

export type ColumnKind =
  | "name"
  | "text"
  | "email"
  | "member"
  | "date"
  | "dateOnly"
  | "money"
  | "enum"
  | "stage"
  | "count"
  | "related"
  | "due";

export interface ColumnSpec {
  key: string;
  label: MessageKey;
  kind: ColumnKind;
  enumPrefix?: string;
}

export const LIST_COLUMNS: Record<ListEntity, ColumnSpec[]> = {
  companies: [
    { key: "name", label: "field.name", kind: "name" },
    { key: "domain", label: "field.domain", kind: "text" },
    { key: "ownerUid", label: "field.ownerUid", kind: "member" },
    { key: "counts.contacts", label: "field.contacts", kind: "count" },
    { key: "counts.openDeals", label: "field.openDeals", kind: "count" },
    { key: "updatedAt", label: "field.updatedAt", kind: "date" },
  ],
  contacts: [
    { key: "name", label: "field.name", kind: "name" },
    { key: "email", label: "field.email", kind: "email" },
    { key: "companyName", label: "field.companyId", kind: "text" },
    { key: "lifecycleStage", label: "field.lifecycleStage", kind: "enum", enumPrefix: "stage" },
    { key: "ownerUid", label: "field.ownerUid", kind: "member" },
    { key: "lastActivityAt", label: "field.lastActivityAt", kind: "date" },
  ],
  leads: [
    { key: "name", label: "field.name", kind: "name" },
    { key: "email", label: "field.email", kind: "email" },
    { key: "companyName", label: "field.companyName", kind: "text" },
    { key: "status", label: "field.status", kind: "enum", enumPrefix: "leadStatus" },
    { key: "source", label: "field.source", kind: "enum", enumPrefix: "source" },
    { key: "ownerUid", label: "field.ownerUid", kind: "member" },
    { key: "createdAt", label: "field.createdAt", kind: "date" },
  ],
  deals: [
    { key: "name", label: "field.name", kind: "name" },
    { key: "amount", label: "field.amount", kind: "money" },
    { key: "stageId", label: "field.stageId", kind: "stage" },
    { key: "status", label: "field.status", kind: "enum", enumPrefix: "dealStatus" },
    { key: "expectedCloseDate", label: "field.expectedCloseDate", kind: "dateOnly" },
    { key: "ownerUid", label: "field.ownerUid", kind: "member" },
  ],
  tasks: [
    { key: "name", label: "field.title", kind: "name" },
    { key: "dueAt", label: "field.dueAt", kind: "due" },
    { key: "priority", label: "field.priority", kind: "enum", enumPrefix: "priority" },
    { key: "status", label: "field.status", kind: "enum", enumPrefix: "taskStatus" },
    { key: "assigneeUid", label: "field.assigneeUid", kind: "member" },
    { key: "related", label: "field.related", kind: "related" },
  ],
};

/** Display name of a plain record. */
export function nameOf(entity: ListEntity, r: Record<string, unknown>): string {
  if (entity === "contacts" || entity === "leads") {
    return [r.firstName, r.lastName].filter(Boolean).join(" ");
  }
  if (entity === "tasks") return String(r.title ?? "");
  return String(r.name ?? "");
}

/** Read "a.b" paths from a plain record. */
export function pick(r: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined),
      r,
    );
}

/** Label for an enum value via the catalog (e.g. "stage.customer"); falls back to the value. */
export function enumLabel(prefix: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (!prefix) return String(value);
  const text = t(`${prefix}.${String(value)}` as MessageKey) as string | undefined;
  return text ?? String(value);
}
