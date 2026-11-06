import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { toCsv } from "@crm/shared/csv";
import { authorizeAgency, authorizePlatform } from "../authz";
import type { BrandingValues } from "../branding/types";
import { resolveEffectiveConfig } from "../config/entitlements";
import type { AgencyContext } from "../contexts/agency-context";
import type { PlatformContext } from "../contexts/platform-context";
import { ConflictError, NotFoundError } from "../errors";
import { getDb } from "../firebase-admin";
import { deliverQueuedMailToConsole } from "../mail";
import type { AgencyDoc, InvitationDoc, StaffDoc, TenantDoc } from "../model";
import { assertSafeId } from "../repositories/base";
import { getServerEnv } from "../server-env";
import { createInvitationInTx } from "./invitations";

// Console detail pages (FR-AGY-005, T-05-09). Workspace metadata only — never CRM records
// (A-09, FR-AGY-002); agencies see only their own workspaces (FR-AGY-003).

export type AdminActor =
  { kind: "agency"; ctx: AgencyContext } | { kind: "platform"; ctx: PlatformContext };

export interface WorkspaceDetail {
  id: string;
  agencyId: string;
  name: string;
  slug: string;
  status: TenantDoc["status"];
  canonicalHost: string;
  billingState: TenantDoc["billingState"];
  planId: string;
  limits: { seats: number; records: number };
  usage: { seats: number; records: number };
  overrides: { seats: number | null; records: number | null };
  flags: Record<string, boolean>;
  branding: BrandingValues & {
    logoLightPath: string | null;
    logoDarkPath: string | null;
    faviconPath: string | null;
  };
  allowWorkspaceBranding: boolean;
  /** FR-BILL-005: billing mode and paid-until date (YYYY-MM-DD) for manual billing. */
  billing: { mode: "gateway" | "manual" | null; status: string | null; paidUntil: string | null };
}

export async function getWorkspaceDetail(
  actor: AdminActor,
  tenantId: string,
): Promise<WorkspaceDetail> {
  assertSafeId(tenantId);
  if (actor.kind === "agency") authorizeAgency(actor.ctx, "agency.workspace.read");
  else authorizePlatform(actor.ctx, "platform.tenant.read");
  const db = getDb();
  const tenant = (await db.doc(`tenants/${tenantId}`).get()).data() as TenantDoc | undefined;
  if (!tenant || (actor.kind === "agency" && tenant.agencyId !== actor.ctx.agencyId)) {
    throw new NotFoundError();
  }
  const [agencySnap, usage, subscription] = await Promise.all([
    db.doc(`agencies/${tenant.agencyId}`).get(),
    db.doc(`tenants/${tenantId}/usage/current`).get(),
    db.doc(`tenants/${tenantId}/billing/subscription`).get(),
  ]);
  const paidUntil = subscription.get("paidUntil") as { toDate(): Date } | null | undefined;
  const agency = agencySnap.data() as AgencyDoc | undefined;
  const config = resolveEffectiveConfig(tenant, agency ?? null);
  const b = (tenant.branding ?? {}) as Record<string, string | undefined>;
  const o = (tenant.entitlementOverrides ?? {}) as Record<string, number | undefined>;
  return {
    id: tenantId,
    agencyId: tenant.agencyId,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    canonicalHost: tenant.canonicalHost,
    billingState: tenant.billingState,
    planId: config.planId,
    limits: { seats: config.limits.seats, records: config.limits.records },
    usage: {
      seats: (usage.get("seats") as number | undefined) ?? 0,
      records: (usage.get("records") as number | undefined) ?? 0,
    },
    overrides: { seats: o.seats ?? null, records: o.records ?? null },
    flags: config.flags,
    branding: {
      appName: b.appName ?? null,
      primaryColor: b.primaryColor ?? null,
      accentColor: b.accentColor ?? null,
      logoLightPath: b.logoLightPath ?? null,
      logoDarkPath: b.logoDarkPath ?? null,
      faviconPath: b.faviconPath ?? null,
    },
    allowWorkspaceBranding: Boolean(agency?.entitlements?.allowWorkspaceBranding),
    billing: {
      mode: (subscription.get("mode") as "gateway" | "manual" | undefined) ?? null,
      status: (subscription.get("status") as string | undefined) ?? null,
      paidUntil: paidUntil ? paidUntil.toDate().toISOString().slice(0, 10) : null,
    },
  };
}

export interface StaffView {
  uid: string;
  email: string;
  displayName: string;
  role: StaffDoc["role"];
}

export async function listStaff(ctx: AgencyContext): Promise<{
  staff: StaffView[];
  pending: Array<{ id: string; email: string }>;
}> {
  authorizeAgency(ctx, "agency.workspace.read");
  const base = getDb().doc(`agencies/${ctx.agencyId}`);
  const [staff, invites] = await Promise.all([
    base.collection("staff").where("status", "==", "active").get(),
    base.collection("invitations").where("status", "==", "pending").get(),
  ]);
  return {
    staff: staff.docs
      .map((d) => d.data() as StaffDoc)
      .map((s) => ({ uid: s.uid, email: s.email, displayName: s.displayName, role: s.role }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    pending: invites.docs
      .map((d) => ({ id: d.id, data: d.data() as InvitationDoc }))
      .filter(({ data }) => data.expiresAt.toMillis() > Date.now())
      .map(({ id, data }) => ({ id, email: data.email })),
  };
}

/** FR-AGY-002: agency owners invite agency admins to the partners console. */
export async function inviteStaff(ctx: AgencyContext, email: string) {
  authorizeAgency(ctx, "agency.staff.manage");
  const partners = getServerEnv().APP_PARTNERS_HOST;
  if (!partners) throw new Error("APP_PARTNERS_HOST must be configured");
  const normalized = email.toLowerCase();
  const base = getDb().doc(`agencies/${ctx.agencyId}`);
  const result = await getDb().runTransaction(async (tx) => {
    const [existing, pending] = await Promise.all([
      tx.get(
        base.collection("staff").where("email", "==", normalized).where("status", "==", "active"),
      ),
      tx.get(
        base
          .collection("invitations")
          .where("email", "==", normalized)
          .where("status", "==", "pending"),
      ),
    ]);
    if (!existing.empty) throw new ConflictError("already_staff");
    if (pending.docs.some((d) => (d.data() as InvitationDoc).expiresAt.toMillis() > Date.now())) {
      throw new ConflictError("invitation_pending");
    }
    return createInvitationInTx(tx, {
      target: { kind: "agency", agencyId: ctx.agencyId, role: "agency_admin" },
      email: normalized,
      invitedBy: ctx.uid,
      host: partners,
      requestId: ctx.requestId,
      displayName: ctx.agency.name,
    });
  });
  await deliverQueuedMailToConsole();
  return { invitationId: result.invitationId, email: normalized };
}

export interface UsageReportRow {
  id: string;
  name: string;
  status: string;
  planId: string;
  billingState: string;
  seats: number;
  seatLimit: number;
  records: number;
  recordLimit: number;
  activeUsers30d: number;
}

/**
 * FR-AGY-006: aggregate per-workspace metrics for the agency's own workspaces only — counts and
 * statuses, never CRM content. Active users = members who signed in during the last 30 days.
 */
export async function agencyUsageReport(ctx: AgencyContext): Promise<UsageReportRow[]> {
  authorizeAgency(ctx, "agency.workspace.read");
  const db = getDb();
  const tenants = await db
    .collection("tenants")
    .where("agencyId", "==", ctx.agencyId)
    .limit(500)
    .get();
  const since = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return Promise.all(
    tenants.docs.map(async (d) => {
      const tenant = d.data() as TenantDoc;
      const [usage, active] = await Promise.all([
        db.doc(`tenants/${d.id}/usage/current`).get(),
        d.ref
          .collection("members")
          .where("status", "==", "active")
          .where("lastSeenAt", ">=", since)
          .count()
          .get(),
      ]);
      const config = resolveEffectiveConfig(tenant, ctx.agency);
      return {
        id: d.id,
        name: tenant.name,
        status: tenant.status,
        planId: config.planId,
        billingState: tenant.billingState,
        seats: (usage.get("seats") as number | undefined) ?? 0,
        seatLimit: config.limits.seats,
        records: (usage.get("records") as number | undefined) ?? 0,
        recordLimit: config.limits.records,
        activeUsers30d: active.data().count,
      };
    }),
  );
}

export function usageReportCsv(rows: UsageReportRow[]): string {
  return toCsv([
    [
      "workspace",
      "status",
      "plan",
      "billingState",
      "seats",
      "seatLimit",
      "records",
      "recordLimit",
      "activeUsers30d",
    ],
    ...rows.map((r) => [
      r.name,
      r.status,
      r.planId,
      r.billingState,
      r.seats,
      r.seatLimit,
      r.records,
      r.recordLimit,
      r.activeUsers30d,
    ]),
  ]);
}
