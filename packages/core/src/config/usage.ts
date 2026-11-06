import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { workspaceScope } from "@crm/shared/permissions";
import { audit } from "../audit";
import { authorize, authorizePlatform } from "../authz";
import type { PlatformContext } from "../contexts/platform-context";
import { clearTenantCaches, type TenantContext } from "../contexts/tenant-context";
import { NotFoundError } from "../errors";
import { getDb } from "../firebase-admin";
import { logger } from "../logger";
import type { TenantDoc } from "../model";
import { assertSafeId } from "../repositories/base";
import {
  FEATURE_FLAGS,
  PLAN_IDS,
  entitlementOverridesSchema,
  getEffectiveConfig,
  type FeatureFlag,
  type PlanId,
} from "./entitlements";

// Usage counters, warnings, and reconciliation (FR-PLAN-002); platform plan management.

export interface UsageSummary {
  planId: PlanId;
  seats: { used: number; limit: number };
  records: { used: number; limit: number };
  level: "ok" | "warning" | "exceeded";
}

const levelOf = (used: number, limit: number) =>
  used >= limit ? "exceeded" : used >= limit * 0.8 ? "warning" : "ok";

export async function getUsageSummary(ctx: TenantContext): Promise<UsageSummary> {
  authorize(ctx, "plan.read");
  return usageFor(ctx);
}

async function usageFor(ctx: TenantContext): Promise<UsageSummary> {
  const [config, usage] = await Promise.all([
    getEffectiveConfig(ctx),
    getDb().doc(`tenants/${ctx.tenantId}/usage/current`).get(),
  ]);
  const seats = {
    used: (usage.get("seats") as number | undefined) ?? 0,
    limit: config.limits.seats,
  };
  const records = {
    used: (usage.get("records") as number | undefined) ?? 0,
    limit: config.limits.records,
  };
  const levels = [levelOf(seats.used, seats.limit), levelOf(records.used, records.limit)];
  const level = levels.includes("exceeded")
    ? "exceeded"
    : levels.includes("warning")
      ? "warning"
      : "ok";
  return { planId: config.planId, seats, records, level };
}

/** Banner for Owners/Admins at 80 % and 100 % (null when not applicable). */
export async function usageBanner(ctx: TenantContext): Promise<UsageSummary | null> {
  if (!workspaceScope(ctx.role, "plan.read")) return null;
  const summary = await usageFor(ctx);
  return summary.level === "ok" ? null : summary;
}

/**
 * Nightly drift correction (job body; scheduled with Cloud Functions, T-01-09): recount seats and
 * non-deleted records with count() aggregations and overwrite the counters. Returns the drift.
 */
export async function reconcileUsage(
  tenantId: string,
): Promise<{ seats: number; records: number }> {
  assertSafeId(tenantId);
  const base = getDb().doc(`tenants/${tenantId}`);
  const count = async (collection: string) =>
    (await base.collection(collection).where("isDeleted", "==", false).count().get()).data().count;
  const [seats, companies, contacts, leads, deals, current] = await Promise.all([
    base.collection("members").where("status", "==", "active").count().get(),
    count("companies"),
    count("contacts"),
    count("leads"),
    count("deals"),
    base.collection("usage").doc("current").get(),
  ]);
  const records = companies + contacts + leads + deals;
  const drift = {
    seats: seats.data().count - ((current.get("seats") as number | undefined) ?? 0),
    records: records - ((current.get("records") as number | undefined) ?? 0),
  };
  await base.collection("usage").doc("current").set(
    {
      seats: seats.data().count,
      records,
      companies,
      contacts,
      leads,
      deals,
      reconciledAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  if (drift.seats || drift.records) logger.warn("usage_drift_corrected", { tenantId, ...drift });
  return drift;
}

/** Platform staff: plan, limit overrides, and feature flags for one workspace (audited). */
export async function setWorkspacePlan(
  ctx: PlatformContext,
  tenantId: string,
  input: {
    planId: string;
    overrides: { seats?: number | null; records?: number | null };
    flags: Partial<Record<FeatureFlag, boolean>>;
  },
) {
  authorizePlatform(ctx, "platform.plan.manage");
  assertSafeId(tenantId);
  if (!(PLAN_IDS as string[]).includes(input.planId)) throw new NotFoundError("plan");
  const overrides = entitlementOverridesSchema.parse(
    Object.fromEntries(
      Object.entries(input.overrides).filter(([, v]) => v !== null && v !== undefined),
    ),
  );
  const flags = Object.fromEntries(
    Object.entries(input.flags).filter(([k]) => (FEATURE_FLAGS as readonly string[]).includes(k)),
  );
  const ref = getDb().doc(`tenants/${tenantId}`);
  await getDb().runTransaction(async (tx) => {
    const tenant = (await tx.get(ref)).data() as TenantDoc | undefined;
    if (!tenant) throw new NotFoundError();
    tx.update(ref, {
      planId: input.planId,
      entitlementOverrides: overrides,
      featureFlags: flags,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const entry = {
      action:
        tenant.planId === input.planId
          ? ("entitlements.updated" as const)
          : ("plan.changed" as const),
      actor: { type: "platform_admin" as const, uid: ctx.uid },
      target: { type: "tenant", id: tenantId },
      changedFields: ["planId", "entitlementOverrides", "featureFlags"],
      meta: { fromPlan: tenant.planId, toPlan: input.planId },
      requestId: ctx.requestId,
    };
    audit(tx, { platform: true }, entry);
    audit(tx, { tenantId }, entry);
  });
  clearTenantCaches();
  return { ok: true };
}
