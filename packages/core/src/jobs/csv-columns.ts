import "server-only";
import type { DocumentData } from "firebase-admin/firestore";
import { minorToDecimalString } from "@crm/shared/records/money";
import { iso } from "../records/plain";

// Export columns per entity (FR-IMP-002). Values are plain text; the CSV serializer neutralises
// formulas. Owner/stage names are resolved through lookups passed by the caller.

export interface Lookups {
  members: Record<string, string>;
  stages: Record<string, string>;
}

type Column = [header: string, value: (d: DocumentData, l: Lookups) => unknown];

const owner: Column = ["owner", (d, l) => l.members[String(d.ownerUid)] ?? d.ownerUid];
const tags: Column = ["tags", (d) => (d.tags as string[] | undefined) ?? []];
const created: Column = ["createdAt", (d) => iso(d.createdAt)];
const updated: Column = ["updatedAt", (d) => iso(d.updatedAt)];

export const EXPORT_COLUMNS: Record<string, Column[]> = {
  contacts: [
    ["id", (d) => d.id],
    ["firstName", (d) => d.firstName],
    ["lastName", (d) => d.lastName],
    ["email", (d) => d.email],
    [
      "phones",
      (d) => ((d.phones as Array<{ number: string }> | undefined) ?? []).map((p) => p.number),
    ],
    ["jobTitle", (d) => d.jobTitle],
    ["company", (d) => d.companyName],
    ["lifecycleStage", (d) => d.lifecycleStage],
    ["leadSource", (d) => d.leadSource],
    owner,
    tags,
    created,
    updated,
  ],
  companies: [
    ["id", (d) => d.id],
    ["name", (d) => d.name],
    ["domain", (d) => d.domain],
    ["website", (d) => d.website],
    ["phone", (d) => d.phone],
    ["industry", (d) => d.industry],
    ["sizeBand", (d) => d.sizeBand],
    ["city", (d) => d.address?.city],
    ["country", (d) => d.address?.country],
    owner,
    tags,
    created,
    updated,
  ],
  leads: [
    ["id", (d) => d.id],
    ["firstName", (d) => d.firstName],
    ["lastName", (d) => d.lastName],
    ["email", (d) => d.email],
    ["phone", (d) => d.phone],
    ["companyName", (d) => d.companyName],
    ["jobTitle", (d) => d.jobTitle],
    ["source", (d) => d.source],
    ["status", (d) => d.status],
    [
      "estimatedValue",
      (d) =>
        typeof d.estimatedValue === "number"
          ? minorToDecimalString(d.estimatedValue, d.currency ?? "USD")
          : "",
    ],
    owner,
    tags,
    created,
  ],
  deals: [
    ["id", (d) => d.id],
    ["name", (d) => d.name],
    [
      "amount",
      (d) =>
        typeof d.amount === "number" ? minorToDecimalString(d.amount, d.currency ?? "USD") : "",
    ],
    ["currency", (d) => d.currency],
    ["stage", (d, l) => l.stages[String(d.stageId)] ?? d.stageId],
    ["status", (d) => d.status],
    ["expectedCloseDate", (d) => iso(d.expectedCloseDate)?.slice(0, 10) ?? ""],
    ["primaryContact", (d) => d.primaryContactName],
    ["company", (d) => d.companyName],
    owner,
    tags,
    created,
  ],
  tasks: [
    ["id", (d) => d.id],
    ["title", (d) => d.title],
    ["dueDate", (d) => d.dueDate],
    ["dueTime", (d) => d.dueTime],
    ["priority", (d) => d.priority],
    ["status", (d) => d.status],
    ["assignee", (d, l) => l.members[String(d.assigneeUid)] ?? d.assigneeUid],
    ["related", (d) => d.related?.label],
    created,
  ],
};

export function csvRows(entity: string, docs: DocumentData[], lookups: Lookups): unknown[][] {
  const cols = EXPORT_COLUMNS[entity]!;
  return docs.map((d) => cols.map(([, value]) => value(d, lookups)));
}

export const csvHeader = (entity: string) => EXPORT_COLUMNS[entity]!.map(([h]) => h);
