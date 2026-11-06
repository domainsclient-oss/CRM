import "server-only";
import { cache } from "react";
import type { TenantContext } from "@crm/core/contexts/tenant";
import { getCompany } from "@crm/core/records/companies";
import { getContact } from "@crm/core/records/contacts";
import { getDeal, getPipeline, openStages } from "@crm/core/records/deals";
import { getLead } from "@crm/core/records/leads";
import { getTask, viewerTimeZone } from "@crm/core/records/tasks";
import {
  listTags,
  memberOptions,
  readTenantSettings,
  recordOptions,
  type Option,
} from "@crm/core/records/workspace-data";
import { listTeam } from "@crm/core/services/members";
import { workspaceScope, type WorkspacePermission } from "@crm/shared/permissions";
import { formatMoney, minorToDecimalString } from "@crm/shared/records/money";
import type { ListEntity } from "@crm/shared/records/list-specs";
import { getWorkspaceAccess } from "@/server/workspace";

// Server-side helpers for record pages. Everything is per request (React cache); nothing about
// a tenant is cached across requests (AGENTS.md rule 6).

export async function requireCtx(): Promise<TenantContext | null> {
  const access = await getWorkspaceAccess();
  return access.status === "ok" ? access.ctx : null; // the layout renders other states
}

export const can = (ctx: TenantContext, permission: WorkspacePermission) =>
  workspaceScope(ctx.role, permission) !== null;
export const canAll = (ctx: TenantContext, permission: WorkspacePermission) =>
  workspaceScope(ctx.role, permission) === "all";

/** uid → display name for every active member (owners may since have become viewers). */
export const getMemberNames = cache(async (ctx: TenantContext): Promise<Record<string, string>> => {
  const team = await listTeam(ctx);
  return Object.fromEntries(team.members.map((m) => [m.uid, m.displayName || m.email]));
});

export interface Formatters {
  locale: string;
  timeZone: string;
  currency: string;
  date: (iso: unknown) => string;
  dateTime: (iso: unknown) => string;
  dateOnly: (iso: unknown) => string;
  money: (minor: unknown) => string;
}

export const getFormatters = cache(async (ctx: TenantContext): Promise<Formatters> => {
  const settings = readTenantSettings(ctx);
  const timeZone = await viewerTimeZone(ctx);
  const dateFmt = new Intl.DateTimeFormat(settings.locale, { dateStyle: "medium", timeZone });
  const dateTimeFmt = new Intl.DateTimeFormat(settings.locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  // Calendar dates (expected close, date-only tasks) are stored at UTC midnight.
  const dateOnlyFmt = new Intl.DateTimeFormat(settings.locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  const asDate = (v: unknown) => (typeof v === "string" && v ? new Date(v) : null);
  return {
    locale: settings.locale,
    timeZone,
    currency: settings.currency,
    date: (v) => (asDate(v) ? dateFmt.format(asDate(v)!) : "—"),
    dateTime: (v) => (asDate(v) ? dateTimeFmt.format(asDate(v)!) : "—"),
    dateOnly: (v) => (asDate(v) ? dateOnlyFmt.format(asDate(v)!) : "—"),
    money: (v) =>
      typeof v === "number" ? formatMoney(v, settings.currency, settings.locale) : "—",
  };
});

export async function loadRecord(ctx: TenantContext, entity: ListEntity, id: string) {
  switch (entity) {
    case "companies":
      return getCompany(ctx, id);
    case "contacts":
      return getContact(ctx, id);
    case "leads":
      return getLead(ctx, id);
    case "deals":
      return getDeal(ctx, id);
    case "tasks":
      return getTask(ctx, id);
  }
}

export interface FormOptions {
  members: Option[];
  companies: Option[];
  contacts: Option[];
  leads: Option[];
  deals: Option[];
  stages: Option[];
  tags: string[];
  canReassign: boolean;
}

export async function getFormOptions(ctx: TenantContext, entity: ListEntity): Promise<FormOptions> {
  const needs = {
    companies: entity === "contacts" || entity === "deals" || entity === "tasks",
    contacts: entity === "deals" || entity === "tasks",
    leadsDeals: entity === "tasks",
    stages: entity === "deals",
  };
  const none = async () => [] as Option[];
  const [members, companies, contacts, leads, deals, pipeline, tags] = await Promise.all([
    memberOptions(ctx),
    needs.companies ? recordOptions(ctx, "companies") : none(),
    needs.contacts ? recordOptions(ctx, "contacts") : none(),
    needs.leadsDeals ? recordOptions(ctx, "leads") : none(),
    needs.leadsDeals ? recordOptions(ctx, "deals") : none(),
    needs.stages ? getPipeline(ctx) : null,
    entity === "tasks" ? Promise.resolve([] as string[]) : listTags(ctx),
  ]);
  return {
    members,
    companies,
    contacts,
    leads,
    deals,
    stages: pipeline ? openStages(pipeline).map((s) => ({ id: s.id, label: s.name })) : [],
    tags,
    canReassign: canAll(ctx, "record.reassign"),
  };
}

export async function stageNames(ctx: TenantContext): Promise<Record<string, string>> {
  const pipeline = await getPipeline(ctx);
  return Object.fromEntries(pipeline.stages.map((s) => [s.id, s.name]));
}

/** Plain record → initial form values (money as decimal strings, dates as YYYY-MM-DD). */
export function toFormValues(
  entity: ListEntity,
  record: Record<string, unknown>,
  currency: string,
): Record<string, unknown> {
  const money = (v: unknown) =>
    typeof v === "number" && v > 0 ? minorToDecimalString(v, currency) : "";
  switch (entity) {
    case "deals":
      return {
        ...record,
        amount: money(record.amount),
        expectedCloseDate:
          typeof record.expectedCloseDate === "string" ? record.expectedCloseDate.slice(0, 10) : "",
      };
    case "leads":
      return { ...record, estimatedValue: money(record.estimatedValue) };
    default:
      return record;
  }
}
