import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { workspaceScope } from "@crm/shared/permissions";
import { isCurrency } from "@crm/shared/records/money";
import { DATE_FORMATS, LOCALES, THEMES, WEEK_STARTS } from "@crm/shared/records/schemas";
import { isValidTimeZone } from "@crm/shared/records/time";
import { audit } from "../audit";
import { authorize } from "../authz";
import { clearTenantCaches, type TenantContext } from "../contexts/tenant-context";
import { ValidationError } from "../errors";
import { getDb } from "../firebase-admin";
import type { MemberDoc } from "../model";
import { scopedQuery, tenantCollection } from "../repositories/base";
import { auditRecord } from "./common";

// Tags catalog, pickers, tenant settings and user profile (FR-REC-002, FR-SET-001/002).

export async function listTags(ctx: TenantContext): Promise<string[]> {
  authorize(ctx, "record.read");
  const snap = await tenantCollection(ctx, "tagDefinitions")
    .orderBy("nameNormalized", "asc")
    .limit(500)
    .get();
  return snap.docs
    .filter((d) => (d.get("usageCount") as number | undefined) !== 0)
    .map((d) => String(d.get("name")));
}

export interface Option {
  id: string;
  label: string;
}

/** Owner/assignee choices: active members who can own records (not viewers). */
export async function memberOptions(ctx: TenantContext): Promise<Option[]> {
  authorize(ctx, "member.read");
  const snap = await tenantCollection(ctx, "members").where("status", "==", "active").get();
  return snap.docs
    .map((d) => d.data() as MemberDoc)
    .filter((m) => m.role !== "viewer")
    .map((m) => ({ id: m.uid, label: m.displayName || m.email }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Visible records for reference pickers (own-scoped for Members), name order, capped. */
export async function recordOptions(
  ctx: TenantContext,
  collection: "companies" | "contacts" | "leads" | "deals",
): Promise<Option[]> {
  const sortField =
    collection === "companies" || collection === "deals" ? "nameLower" : "fullNameLower";
  const snap = await scopedQuery(ctx, collection).orderBy(sortField, "asc").limit(200).get();
  return snap.docs.map((d) => ({
    id: d.id,
    label:
      collection === "companies" || collection === "deals"
        ? String(d.get("name"))
        : [d.get("firstName"), d.get("lastName")].filter(Boolean).join(" "),
  }));
}

// ---- Tenant settings (FR-SET-001) ----

export interface TenantSettings {
  timezone: string;
  locale: string;
  currency: string;
  dateFormat: string;
  weekStart: string;
  fiscalYearStartMonth: number;
}

export function readTenantSettings(ctx: TenantContext): TenantSettings {
  const s = ctx.tenant.settings as Partial<TenantSettings>;
  return {
    timezone: s.timezone ?? "UTC",
    locale: s.locale ?? "en-US",
    currency: s.currency ?? "USD",
    dateFormat: s.dateFormat ?? "YYYY-MM-DD",
    weekStart: s.weekStart ?? "monday",
    fiscalYearStartMonth: s.fiscalYearStartMonth ?? 1,
  };
}

export async function updateTenantSettings(ctx: TenantContext, input: TenantSettings) {
  authorize(ctx, "settings.manage");
  const errors: Record<string, string[]> = {};
  if (!isValidTimeZone(input.timezone)) errors.timezone = ["Choose a valid time zone"];
  if (!(LOCALES as readonly string[]).includes(input.locale))
    errors.locale = ["Unsupported locale"];
  if (!isCurrency(input.currency)) errors.currency = ["Unsupported currency"];
  if (!(DATE_FORMATS as readonly string[]).includes(input.dateFormat))
    errors.dateFormat = ["Unsupported format"];
  if (!(WEEK_STARTS as readonly string[]).includes(input.weekStart))
    errors.weekStart = ["Unsupported value"];
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const before = readTenantSettings(ctx);
  const changed = (Object.keys(input) as Array<keyof TenantSettings>).filter(
    (k) => before[k] !== input[k],
  );
  if (changed.length === 0) return { changed: [] };
  await getDb().runTransaction(async (tx) => {
    tx.update(getDb().doc(`tenants/${ctx.tenantId}`), {
      settings: input,
      updatedAt: FieldValue.serverTimestamp(),
    });
    auditRecord(
      tx,
      ctx,
      "tenant.settings_updated",
      { type: "tenant", id: ctx.tenantId },
      {
        changedFields: changed,
      },
    );
  });
  clearTenantCaches(); // this instance applies immediately; others within the cache TTL
  return { changed };
}

// ---- Profile (FR-SET-002) ----

export interface Profile {
  displayName: string;
  email: string;
  timezone: string | null;
  theme: (typeof THEMES)[number];
}

export async function getProfile(ctx: TenantContext): Promise<Profile> {
  const user = (await getDb().doc(`users/${ctx.uid}`).get()).data() ?? {};
  const member = (await tenantCollection(ctx, "members").doc(ctx.uid).get()).data() as
    MemberDoc | undefined;
  return {
    displayName: String(user.displayName ?? member?.displayName ?? ""),
    email: String(user.email ?? member?.email ?? ""),
    timezone: (user.timezone as string | undefined) ?? null,
    theme: (THEMES as readonly string[]).includes(user.theme) ? user.theme : "system",
  };
}

/**
 * Updates the user doc and the display-name snapshot in each of the user's memberships
 * (requirements/03 §6: denormalized member names).
 */
export async function updateProfile(
  ctx: TenantContext,
  input: { displayName: string; timezone: string | null; theme: (typeof THEMES)[number] },
) {
  if (input.timezone && !isValidTimeZone(input.timezone)) {
    throw new ValidationError({ timezone: ["Choose a valid time zone"] });
  }
  const userRef = getDb().doc(`users/${ctx.uid}`);
  const tenantIds = ((await userRef.get()).get("tenantIds") as string[] | undefined) ?? [];
  const batch = getDb().batch();
  batch.set(
    userRef,
    {
      displayName: input.displayName,
      timezone: input.timezone,
      theme: input.theme,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  // Only memberships that exist (tenantIds is a hint; members docs are authoritative).
  const memberRefs = [...new Set([...tenantIds, ctx.tenantId])].map((tenantId) =>
    getDb().doc(`tenants/${tenantId}/members/${ctx.uid}`),
  );
  const members = await getDb().getAll(...memberRefs);
  for (const snap of members) {
    if (snap.exists) batch.update(snap.ref, { displayName: input.displayName });
  }
  audit(
    batch,
    { tenantId: ctx.tenantId },
    {
      action: "user.profile_updated",
      actor: { type: "user", uid: ctx.uid },
      target: { type: "user", id: ctx.uid },
      changedFields: ["displayName", "timezone", "theme"],
      requestId: ctx.requestId,
    },
  );
  await batch.commit();
  return { ok: true };
}

export function canManagePipeline(ctx: TenantContext): boolean {
  return workspaceScope(ctx.role, "pipeline.manage") !== null;
}
