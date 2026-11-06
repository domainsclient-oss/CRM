import "server-only";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import type { BrandAssetKind, BrandingInput } from "@crm/shared/branding/schemas";
import { deriveTheme } from "@crm/shared/branding/theme";
import { audit, type AuditScope } from "../audit";
import { authorize, authorizeAgency } from "../authz";
import type { AgencyContext } from "../contexts/agency-context";
import { clearTenantCaches, type TenantContext } from "../contexts/tenant-context";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { getDb } from "../firebase-admin";
import type { AgencyDoc, TenantDoc } from "../model";
import { assertSafeId } from "../repositories/base";
import { storeBrandAsset } from "./assets";
import { resolveBranding, type StoredBranding } from "./resolve";

// Branding changes (FR-BRAND-001/002, FR-AGY-004). Who may edit:
// - workspace Owner/Admin (branding.manage) — only if the agency allows workspace branding;
// - agency staff (agency.workspace.branding) for their own agency's workspaces — always;
// - agency staff (agency.branding.manage) for the agency defaults.

export type BrandActor =
  { kind: "tenant"; ctx: TenantContext } | { kind: "agency"; ctx: AgencyContext };
export type BrandTarget = { level: "workspace"; tenantId: string } | { level: "agency" };

interface Authorized {
  ref: DocumentReference;
  scopeId: { kind: "tenant" | "agency"; id: string };
  auditScopes: AuditScope[];
  actorRef: { type: "user" | "agency_staff"; uid: string };
  requestId: string;
  agency: AgencyDoc;
  tenant: TenantDoc | null;
}

async function authorizeTarget(actor: BrandActor, target: BrandTarget): Promise<Authorized> {
  const db = getDb();
  if (actor.kind === "tenant") {
    const { ctx } = actor;
    if (target.level !== "workspace" || target.tenantId !== ctx.tenantId) throw new NotFoundError();
    authorize(ctx, "branding.manage");
    const agency = (await db.doc(`agencies/${ctx.agencyId}`).get()).data() as AgencyDoc | undefined;
    if (!agency?.entitlements?.allowWorkspaceBranding) {
      throw new ForbiddenError("workspace_branding_disabled");
    }
    return {
      ref: db.doc(`tenants/${ctx.tenantId}`),
      scopeId: { kind: "tenant", id: ctx.tenantId },
      auditScopes: [{ tenantId: ctx.tenantId }],
      actorRef: { type: "user", uid: ctx.uid },
      requestId: ctx.requestId,
      agency,
      tenant: ctx.tenant,
    };
  }
  const { ctx } = actor;
  if (target.level === "agency") {
    authorizeAgency(ctx, "agency.branding.manage");
    return {
      ref: db.doc(`agencies/${ctx.agencyId}`),
      scopeId: { kind: "agency", id: ctx.agencyId },
      auditScopes: [{ agencyId: ctx.agencyId }],
      actorRef: { type: "agency_staff", uid: ctx.uid },
      requestId: ctx.requestId,
      agency: ctx.agency,
      tenant: null,
    };
  }
  authorizeAgency(ctx, "agency.workspace.branding");
  assertSafeId(target.tenantId);
  const tenant = (await db.doc(`tenants/${target.tenantId}`).get()).data() as TenantDoc | undefined;
  if (!tenant || tenant.agencyId !== ctx.agencyId) throw new NotFoundError(); // FR-AGY-003
  return {
    ref: db.doc(`tenants/${target.tenantId}`),
    scopeId: { kind: "tenant", id: target.tenantId },
    auditScopes: [{ agencyId: ctx.agencyId }, { tenantId: target.tenantId }],
    actorRef: { type: "agency_staff", uid: ctx.uid },
    requestId: ctx.requestId,
    agency: ctx.agency,
    tenant,
  };
}

async function writeBranding(
  a: Authorized,
  patch: Partial<Record<keyof StoredBranding, string | null>>,
  meta: Record<string, string>,
) {
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  for (const [k, v] of Object.entries(patch)) update[`branding.${k}`] = v ?? FieldValue.delete();
  const batch = getDb().batch();
  batch.update(a.ref, update);
  for (const scope of a.auditScopes) {
    audit(batch, scope, {
      action: "branding.updated",
      actor: a.actorRef,
      target: { type: a.scopeId.kind, id: a.scopeId.id },
      changedFields: Object.keys(patch),
      meta,
      requestId: a.requestId,
    });
  }
  await batch.commit();
  clearTenantCaches(); // this instance now; others within the cache TTL (≤ 60 s)
}

/** App name and colours. Colours must yield a compliant theme (FR-BRAND-002 AC2). */
export async function updateBranding(actor: BrandActor, target: BrandTarget, input: BrandingInput) {
  const a = await authorizeTarget(actor, target);
  // Validate against the colours that will actually be in effect after this change.
  const nextTenant = a.tenant ? { branding: { ...a.tenant.branding, ...input } } : null;
  const nextAgency = a.tenant
    ? a.agency
    : { ...a.agency, branding: { ...a.agency.branding, ...input } };
  const effective = resolveBranding(
    { ...nextAgency, entitlements: { ...nextAgency.entitlements, allowWorkspaceBranding: true } },
    nextTenant,
  );
  const result = deriveTheme(effective.primaryColor, effective.accentColor);
  if (!result.ok) {
    throw new ValidationError(
      {
        [result.field]: [
          result.suggestion
            ? `This colour can't meet contrast requirements. Try ${result.suggestion}.`
            : "This colour can't meet contrast requirements.",
        ],
      },
      "contrast",
    );
  }
  await writeBranding(
    a,
    { appName: input.appName, primaryColor: input.primaryColor, accentColor: input.accentColor },
    { level: target.level },
  );
  return { ok: true };
}

const PATH_FIELD: Record<BrandAssetKind, keyof StoredBranding> = {
  logoLight: "logoLightPath",
  logoDark: "logoDarkPath",
  favicon: "faviconPath",
};

export async function uploadBrandAsset(
  actor: BrandActor,
  target: BrandTarget,
  kind: BrandAssetKind,
  bytes: Uint8Array,
) {
  const a = await authorizeTarget(actor, target);
  const stored = await storeBrandAsset(a.scopeId, kind, bytes);
  await writeBranding(a, { [PATH_FIELD[kind]]: stored.path }, { level: target.level, asset: kind });
  return { path: stored.path };
}

export async function removeBrandAsset(
  actor: BrandActor,
  target: BrandTarget,
  kind: BrandAssetKind,
) {
  const a = await authorizeTarget(actor, target);
  // Content-addressed files stay (another level/version may reference them); only the pointer goes.
  await writeBranding(a, { [PATH_FIELD[kind]]: null }, { level: target.level, asset: kind });
  return { ok: true };
}
