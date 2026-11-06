"use server";

import { z } from "zod";
import { deliverQueuedMailToConsole } from "@crm/core/mail";
import { FEATURE_FLAGS, PLAN_IDS, type PlanId } from "@crm/core/config/entitlements";
import { setWorkspacePlan } from "@crm/core/config/usage";
import {
  addDomain,
  checkDomain,
  removeDomain,
  setCanonicalDomain,
} from "@crm/core/domains/service";
import { POLICIES } from "@crm/core/rate-limit";
import {
  provisionAgency,
  provisionWorkspace,
  setAgencyStatus,
  setWorkspaceStatus,
} from "@crm/core/services/provisioning";
import {
  emailSchema,
  idempotencyKeySchema,
  orgNameSchema,
  slugSchema,
} from "@crm/shared/schemas/auth";
import { actions } from "@/server/actions";

// Platform console actions (FR-AGY-001, FR-TEN-001/002). Sensitive → re-auth required
// (FR-AUTH-008 AC3) and per-user rate limits.

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const statusSchema = z.enum(["active", "suspended"]);

export const createAgencyAction = actions.platform({
  name: "platform.agencies.create",
  permission: "platform.agency.manage",
  reauth: true,
  rateLimit: POLICIES.provisioningByUser,
  schema: z.object({
    name: orgNameSchema,
    slug: slugSchema,
    ownerEmail: emailSchema,
    maxWorkspaces: z.coerce.number().int().min(1).max(10_000),
    maxSeatsTotal: z.coerce.number().int().min(1).max(1_000_000),
    canProvisionWorkspaces: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
  }),
  handler: async (ctx, input) => {
    const result = await provisionAgency(ctx, input);
    await deliverQueuedMailToConsole();
    return result;
  },
});

export const setAgencyStatusAction = actions.platform({
  name: "platform.agencies.setStatus",
  permission: "platform.agency.manage",
  reauth: true,
  schema: z.object({ agencyId: idSchema, status: statusSchema }),
  handler: async (ctx, { agencyId, status }) => {
    await setAgencyStatus(ctx, agencyId, status);
    return { agencyId, status };
  },
});

export const createWorkspaceAction = actions.platform({
  name: "platform.workspaces.create",
  permission: "platform.tenant.manage",
  reauth: true,
  rateLimit: POLICIES.provisioningByUser,
  schema: z.object({
    agencyId: idSchema,
    name: orgNameSchema,
    slug: slugSchema,
    ownerEmail: emailSchema,
    idempotencyKey: idempotencyKeySchema,
  }),
  handler: async (ctx, input) => {
    const result = await provisionWorkspace({ kind: "platform", ctx }, input);
    await deliverQueuedMailToConsole();
    return result;
  },
});

export const setWorkspaceStatusAction = actions.platform({
  name: "platform.workspaces.setStatus",
  permission: "platform.tenant.manage",
  reauth: true,
  schema: z.object({ tenantId: idSchema, status: statusSchema }),
  handler: async (ctx, { tenantId, status }) => {
    await setWorkspaceStatus({ kind: "platform", ctx }, tenantId, status);
    return { tenantId, status };
  },
});

// ---- Plans + domains for one workspace (FR-PLAN-001/004, FR-TEN-005) ----

const hostSchema = z.string().trim().min(3).max(260);

export const setWorkspacePlanAction = actions.platform({
  name: "platform.workspaces.setPlan",
  permission: "platform.plan.manage",
  reauth: true,
  schema: z.object({
    tenantId: idSchema,
    planId: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]),
    seats: z.preprocess(
      (v) => (v === "" || v === null ? null : Number(v)),
      z.number().int().min(1).nullable(),
    ),
    records: z.preprocess(
      (v) => (v === "" || v === null ? null : Number(v)),
      z.number().int().min(0).nullable(),
    ),
    flags: z.partialRecord(z.enum(FEATURE_FLAGS), z.boolean()),
  }),
  handler: (ctx, input) =>
    setWorkspacePlan(ctx, input.tenantId, {
      planId: input.planId,
      overrides: { seats: input.seats, records: input.records },
      flags: input.flags,
    }),
});

export const platformAddDomainAction = actions.platform({
  name: "platform.domains.add",
  permission: "platform.tenant.manage",
  reauth: true,
  schema: z.object({ tenantId: idSchema, host: hostSchema }),
  handler: (ctx, input) => addDomain({ kind: "platform", ctx }, input.tenantId, input.host),
});

export const platformCheckDomainAction = actions.platform({
  name: "platform.domains.check",
  permission: "platform.tenant.manage",
  schema: z.object({ tenantId: idSchema, host: hostSchema }),
  handler: (ctx, input) => checkDomain({ kind: "platform", ctx }, input.tenantId, input.host),
});

export const platformSetCanonicalDomainAction = actions.platform({
  name: "platform.domains.setCanonical",
  permission: "platform.tenant.manage",
  reauth: true,
  schema: z.object({ tenantId: idSchema, host: hostSchema }),
  handler: (ctx, input) =>
    setCanonicalDomain({ kind: "platform", ctx }, input.tenantId, input.host),
});

export const platformRemoveDomainAction = actions.platform({
  name: "platform.domains.remove",
  permission: "platform.tenant.manage",
  reauth: true,
  schema: z.object({ tenantId: idSchema, host: hostSchema }),
  handler: (ctx, input) => removeDomain({ kind: "platform", ctx }, input.tenantId, input.host),
});
