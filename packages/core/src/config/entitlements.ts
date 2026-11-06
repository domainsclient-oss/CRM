import "server-only";
import { Timestamp, type Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { loadAgencyDoc, type TenantContext } from "../contexts/tenant-context";
import { AppError } from "../errors";
import { getDb } from "../firebase-admin";
import type { AgencyDoc, TenantDoc } from "../model";

// Plans, entitlements, feature flags (FR-PLAN-001/004, FR-BRAND-004, requirements/05 §8).
// Effective config = platform defaults → plan template → agency caps → platform-staff overrides →
// billing state. Resolved server-side per request; the client only receives booleans/limits it
// needs. Plan templates are code-owned (placeholders until the owner confirms the plan table).

export interface Entitlements {
  limits: { seats: number; records: number; importRowsPerJob: number };
  features: { reports: boolean; import: boolean; auditExport: boolean };
  whiteLabel: { removePoweredBy: boolean };
}

export const FEATURE_FLAGS = ["dashboardV2", "bulkActions", "globalSearch"] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
const DEFAULT_FLAGS: Record<FeatureFlag, boolean> = {
  dashboardV2: false,
  bulkActions: false,
  globalSearch: false,
};

const UNLIMITED = 1_000_000_000;

export const PLAN_TEMPLATES = {
  trial: {
    limits: { seats: 3, records: 1_000, importRowsPerJob: 1_000 },
    features: { reports: true, import: true, auditExport: false },
    whiteLabel: { removePoweredBy: false },
  },
  starter: {
    limits: { seats: 5, records: 10_000, importRowsPerJob: 10_000 },
    features: { reports: true, import: true, auditExport: false },
    whiteLabel: { removePoweredBy: false },
  },
  growth: {
    limits: { seats: 25, records: 100_000, importRowsPerJob: 10_000 },
    features: { reports: true, import: true, auditExport: true },
    whiteLabel: { removePoweredBy: true },
  },
  enterprise: {
    limits: { seats: UNLIMITED, records: UNLIMITED, importRowsPerJob: 100_000 },
    features: { reports: true, import: true, auditExport: true },
    whiteLabel: { removePoweredBy: true },
  },
} as const satisfies Record<string, Entitlements>;
export type PlanId = keyof typeof PLAN_TEMPLATES;
export const PLAN_IDS = Object.keys(PLAN_TEMPLATES) as PlanId[];

/** Platform-staff overrides stored on tenants/{t}.entitlementOverrides (typed; unknown keys rejected). */
export const entitlementOverridesSchema = z
  .object({
    seats: z.number().int().min(1).max(UNLIMITED).optional(),
    records: z.number().int().min(0).max(UNLIMITED).optional(),
    importRowsPerJob: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();
export const featureFlagsSchema = z.partialRecord(z.enum(FEATURE_FLAGS), z.boolean());

export interface EffectiveConfig extends Entitlements {
  planId: PlanId;
  flags: Record<FeatureFlag, boolean>;
  /** Billing read-only (past grace or expired trial): mutations blocked, data kept. */
  readOnly: boolean;
  showPoweredBy: boolean;
}

export function resolveEffectiveConfig(
  tenant: Pick<TenantDoc, "planId" | "billingState"> & {
    entitlementOverrides?: unknown;
    featureFlags?: unknown;
    trialEndsAt?: unknown;
  },
  agency: Pick<AgencyDoc, "entitlements"> | null,
  now = new Date(),
): EffectiveConfig {
  const planId: PlanId = tenant.planId in PLAN_TEMPLATES ? (tenant.planId as PlanId) : "trial";
  const plan = PLAN_TEMPLATES[planId];
  const overrides = entitlementOverridesSchema.safeParse(tenant.entitlementOverrides ?? {});
  // Typed flags: known keys with boolean values only; anything else is ignored.
  const stored = (tenant.featureFlags ?? {}) as Record<string, unknown>;
  const flags = Object.fromEntries(
    FEATURE_FLAGS.filter((f) => typeof stored[f] === "boolean").map((f) => [
      f,
      stored[f] as boolean,
    ]),
  );
  const removePoweredBy =
    plan.whiteLabel.removePoweredBy && Boolean(agency?.entitlements?.removePoweredBy);
  const trialEnded =
    tenant.billingState === "trialing" &&
    tenant.trialEndsAt instanceof Timestamp &&
    tenant.trialEndsAt.toMillis() < now.getTime();
  return {
    planId,
    limits: {
      ...plan.limits,
      ...(overrides.success
        ? (Object.fromEntries(
            Object.entries(overrides.data).filter(([, v]) => v !== undefined),
          ) as Partial<Entitlements["limits"]>)
        : {}),
    },
    features: { ...plan.features },
    whiteLabel: { removePoweredBy },
    flags: { ...DEFAULT_FLAGS, ...flags },
    readOnly: tenant.billingState === "read_only" || trialEnded,
    showPoweredBy: !removePoweredBy,
  };
}

export async function getEffectiveConfig(
  ctx: Pick<TenantContext, "tenant" | "agencyId">,
): Promise<EffectiveConfig> {
  return resolveEffectiveConfig(ctx.tenant, await loadAgencyDoc(ctx.agencyId));
}

/** Upgrade guidance travels in the error detail; the UI shows the generic plan-limit message. */
export class PlanLimitError extends AppError {
  constructor(detail: string) {
    super("PLAN_LIMIT_EXCEEDED", detail);
  }
}

/**
 * Record limit (FR-PLAN-001): checked inside the creating transaction against usage/current.
 * `adding` = number of counted records the transaction creates.
 */
export async function assertRecordCapacity(
  tx: Transaction,
  ctx: Pick<TenantContext, "tenant" | "agencyId" | "tenantId">,
  adding: number,
): Promise<void> {
  if (adding <= 0) return;
  const config = await getEffectiveConfig(ctx);
  const usage = await tx.get(getDb().doc(`tenants/${ctx.tenantId}/usage/current`));
  const records = (usage.get("records") as number | undefined) ?? 0;
  if (records + adding > config.limits.records) throw new PlanLimitError("records");
}

/** Seat limit at invitation and acceptance (FR-RBAC-001 AC4 / FR-PLAN-001). */
export function assertSeatCapacity(config: EffectiveConfig, seatsInUse: number, adding = 1): void {
  if (seatsInUse + adding > config.limits.seats) throw new PlanLimitError("seats");
}

/** Read-only workspaces may still read, export, and manage billing (FR-BILL-002 AC3). */
export const READ_ONLY_ALLOWED = new Set([
  "record.read",
  "report.read",
  "member.read",
  "audit.read",
  "plan.read",
  "billing.read",
  "billing.manage",
  "record.export",
  "report.export",
  "tenant.export",
]);
