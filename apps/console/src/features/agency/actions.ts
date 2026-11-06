"use server";

import { z } from "zod";
import { deliverQueuedMailToConsole } from "@crm/core/mail";
import { removeBrandAsset, updateBranding, uploadBrandAsset } from "@crm/core/branding/service";
import {
  addAgencySubdomain,
  addDomain,
  checkDomain,
  removeDomain,
  setAgencyBaseDomain,
  setCanonicalDomain,
} from "@crm/core/domains/service";
import {
  configureGateway,
  gatewayConfigSchema,
  removePlanPrice,
  setManualBilling,
  setPlanPrice,
} from "@crm/core/payments";
import { POLICIES } from "@crm/core/rate-limit";
import { agencyUsageReport, inviteStaff, usageReportCsv } from "@crm/core/services/agency-admin";
import { BRAND_ASSET_KINDS, brandingInput } from "@crm/shared/branding/schemas";
import { provisionWorkspace, setWorkspaceStatus } from "@crm/core/services/provisioning";
import {
  emailSchema,
  idempotencyKeySchema,
  orgNameSchema,
  slugSchema,
} from "@crm/shared/schemas/auth";
import { actions } from "@/server/actions";

// Agency console actions (FR-AGY-002/003). The agency always comes from the caller's staff
// record — inputs never carry an agencyId.

export const createWorkspaceAction = actions.agency({
  name: "agency.workspaces.create",
  permission: "agency.workspace.create",
  reauth: true,
  rateLimit: POLICIES.provisioningByUser,
  schema: z.object({
    name: orgNameSchema,
    slug: slugSchema,
    ownerEmail: emailSchema,
    idempotencyKey: idempotencyKeySchema,
  }),
  handler: async (ctx, input) => {
    const result = await provisionWorkspace({ kind: "agency", ctx }, input);
    await deliverQueuedMailToConsole();
    return result;
  },
});

export const setWorkspaceStatusAction = actions.agency({
  name: "agency.workspaces.setStatus",
  permission: "agency.workspace.suspend",
  reauth: true,
  schema: z.object({
    tenantId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    status: z.enum(["active", "suspended"]),
  }),
  handler: async (ctx, { tenantId, status }) => {
    await setWorkspaceStatus({ kind: "agency", ctx }, tenantId, status);
    return { tenantId, status };
  },
});

// ---- Branding (FR-BRAND-001, FR-AGY-004) ----

const tenantIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const fileSchema = z.instanceof(File).refine((f) => f.size <= 1024 * 1024 + 1, "Too large");
const hostSchema = z.string().trim().min(3).max(260);

export const updateAgencyBrandingAction = actions.agency({
  name: "agency.branding.update",
  permission: "agency.branding.manage",
  schema: brandingInput,
  handler: (ctx, input) => updateBranding({ kind: "agency", ctx }, { level: "agency" }, input),
});

export const uploadAgencyAssetAction = actions.agency({
  name: "agency.branding.upload",
  permission: "agency.branding.manage",
  schema: z.object({ kind: z.enum(BRAND_ASSET_KINDS), file: fileSchema }),
  handler: async (ctx, input) =>
    uploadBrandAsset(
      { kind: "agency", ctx },
      { level: "agency" },
      input.kind,
      new Uint8Array(await input.file.arrayBuffer()),
    ),
});

export const removeAgencyAssetAction = actions.agency({
  name: "agency.branding.removeAsset",
  permission: "agency.branding.manage",
  schema: z.object({ kind: z.enum(BRAND_ASSET_KINDS) }),
  handler: (ctx, input) =>
    removeBrandAsset({ kind: "agency", ctx }, { level: "agency" }, input.kind),
});

export const updateClientBrandingAction = actions.agency({
  name: "agency.workspaceBranding.update",
  permission: "agency.workspace.branding",
  schema: brandingInput.extend({ tenantId: tenantIdSchema }),
  handler: (ctx, { tenantId, ...input }) =>
    updateBranding({ kind: "agency", ctx }, { level: "workspace", tenantId }, input),
});

export const uploadClientAssetAction = actions.agency({
  name: "agency.workspaceBranding.upload",
  permission: "agency.workspace.branding",
  schema: z.object({ tenantId: tenantIdSchema, kind: z.enum(BRAND_ASSET_KINDS), file: fileSchema }),
  handler: async (ctx, input) =>
    uploadBrandAsset(
      { kind: "agency", ctx },
      { level: "workspace", tenantId: input.tenantId },
      input.kind,
      new Uint8Array(await input.file.arrayBuffer()),
    ),
});

export const removeClientAssetAction = actions.agency({
  name: "agency.workspaceBranding.removeAsset",
  permission: "agency.workspace.branding",
  schema: z.object({ tenantId: tenantIdSchema, kind: z.enum(BRAND_ASSET_KINDS) }),
  handler: (ctx, input) =>
    removeBrandAsset(
      { kind: "agency", ctx },
      { level: "workspace", tenantId: input.tenantId },
      input.kind,
    ),
});

// ---- Domains (FR-TEN-005, FR-TEN-009) — sensitive: re-auth required ----

export const addDomainAction = actions.agency({
  name: "agency.domains.add",
  permission: "agency.workspace.domain",
  reauth: true,
  schema: z.object({ tenantId: tenantIdSchema, host: hostSchema }),
  handler: (ctx, input) => addDomain({ kind: "agency", ctx }, input.tenantId, input.host),
});

export const checkDomainAction = actions.agency({
  name: "agency.domains.check",
  permission: "agency.workspace.domain",
  schema: z.object({ tenantId: tenantIdSchema, host: hostSchema }),
  handler: (ctx, input) => checkDomain({ kind: "agency", ctx }, input.tenantId, input.host),
});

export const setCanonicalDomainAction = actions.agency({
  name: "agency.domains.setCanonical",
  permission: "agency.workspace.domain",
  reauth: true,
  schema: z.object({ tenantId: tenantIdSchema, host: hostSchema }),
  handler: (ctx, input) => setCanonicalDomain({ kind: "agency", ctx }, input.tenantId, input.host),
});

export const removeDomainAction = actions.agency({
  name: "agency.domains.remove",
  permission: "agency.workspace.domain",
  reauth: true,
  schema: z.object({ tenantId: tenantIdSchema, host: hostSchema }),
  handler: (ctx, input) => removeDomain({ kind: "agency", ctx }, input.tenantId, input.host),
});

export const addAgencySubdomainAction = actions.agency({
  name: "agency.domains.addSubdomain",
  permission: "agency.workspace.domain",
  reauth: true,
  schema: z.object({ tenantId: tenantIdSchema }),
  handler: (ctx, input) => addAgencySubdomain({ kind: "agency", ctx }, input.tenantId),
});

export const setBaseDomainAction = actions.agency({
  name: "agency.domains.setBase",
  permission: "agency.workspace.domain",
  reauth: true,
  schema: z.object({ host: z.preprocess((v) => (v === "" ? null : v), hostSchema.nullable()) }),
  handler: (ctx, input) => setAgencyBaseDomain(ctx, input.host),
});

// ---- Staff (FR-AGY-002) ----

export const inviteStaffAction = actions.agency({
  name: "agency.staff.invite",
  permission: "agency.staff.manage",
  schema: z.object({ email: emailSchema }),
  handler: (ctx, input) => inviteStaff(ctx, input.email),
});

// ---- Usage report (FR-AGY-006) ----

export const usageReportCsvAction = actions.agency({
  name: "agency.report.csv",
  permission: "agency.workspace.read",
  schema: z.object({}),
  handler: async (ctx) => ({ csv: usageReportCsv(await agencyUsageReport(ctx)) }),
});

// ---- Billing (FR-BILL-001, FR-BILL-005). Credentials are write-only; owner + re-auth (T27).

export const configureGatewayAction = actions.agency({
  name: "agency.billing.configureGateway",
  permission: "agency.billing.manage",
  reauth: true,
  schema: gatewayConfigSchema,
  handler: (ctx, input) => configureGateway(ctx, input),
});

export const setPlanPriceAction = actions.agency({
  name: "agency.billing.setPlanPrice",
  permission: "agency.billing.manage",
  schema: z.object({
    planId: z.enum(["starter", "growth", "enterprise"]),
    gatewayPlanId: z.string().trim().min(3).max(100),
  }),
  handler: (ctx, input) => setPlanPrice(ctx, input),
});

export const removePlanPriceAction = actions.agency({
  name: "agency.billing.removePlanPrice",
  permission: "agency.billing.manage",
  schema: z.object({ planId: z.enum(["starter", "growth", "enterprise"]) }),
  handler: (ctx, input) => removePlanPrice(ctx, input.planId),
});

export const setManualBillingAction = actions.agency({
  name: "agency.billing.setManual",
  permission: "agency.billing.manage",
  schema: z.object({
    tenantId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    planId: z.enum(["trial", "starter", "growth", "enterprise"]),
    paidUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  handler: (ctx, input) =>
    setManualBilling(ctx, input.tenantId, { planId: input.planId, paidUntil: input.paidUntil }),
});
