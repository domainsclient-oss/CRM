import "server-only";
import { FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import { audit } from "../audit";
import { authorizeAgency } from "../authz";
import type { AgencyContext } from "../contexts/agency-context";
import type { PlatformContext } from "../contexts/platform-context";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { getDb } from "../firebase-admin";
import type { AgencyDoc, LifecycleStatus, TenantDoc } from "../model";
import { DEFAULT_PIPELINE } from "../records/deals";
import { getServerEnv } from "../server-env";
import { createInvitationInTx } from "./invitations";

// Agency and workspace provisioning (FR-AGY-001, FR-TEN-001/002/003; requirements/05 §3).
// [CONFIRMED] No public signup: only platform staff (and entitled agency staff) provision.

function requiredHost(name: "APP_BASE_DOMAIN" | "APP_PARTNERS_HOST"): string {
  const value = getServerEnv()[name];
  if (!value) throw new Error(`${name} must be configured to provision`);
  return value.toLowerCase();
}

/** Idempotent retries: same actor + key returns the first result (FR-TEN-001 AC4). */
async function idempotent<T extends Record<string, string>>(
  tx: Transaction,
  uid: string,
  key: string,
): Promise<{ prior: T | null; save: (result: T) => void }> {
  const ref = getDb().doc(`idempotencyKeys/${uid}_${key}`);
  const snap = await tx.get(ref);
  return {
    prior: snap.exists ? (snap.get("result") as T) : null,
    save: (result) =>
      tx.set(ref, { result, expireAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000) }),
  };
}

export interface ProvisionAgencyInput {
  name: string;
  slug: string;
  ownerEmail: string;
  maxWorkspaces: number;
  maxSeatsTotal: number;
  canProvisionWorkspaces: boolean;
  idempotencyKey: string;
}

export async function provisionAgency(ctx: PlatformContext, input: ProvisionAgencyInput) {
  const partnersHost = requiredHost("APP_PARTNERS_HOST");
  return getDb().runTransaction(async (tx) => {
    const { prior, save } = await idempotent<{ agencyId: string }>(
      tx,
      ctx.uid,
      input.idempotencyKey,
    );
    if (prior) return prior;
    const slugRef = getDb().doc(`agencySlugs/${input.slug}`);
    if ((await tx.get(slugRef)).exists) throw new ConflictError("slug_taken");

    const agencyRef = getDb().collection("agencies").doc();
    const agency: AgencyDoc = {
      name: input.name,
      slug: input.slug,
      status: "active",
      ownerUid: null,
      quotas: { maxWorkspaces: input.maxWorkspaces, maxSeatsTotal: input.maxSeatsTotal },
      entitlements: {
        canProvisionWorkspaces: input.canProvisionWorkspaces,
        allowWorkspaceBranding: true,
        removePoweredBy: false,
      },
      branding: { appName: input.name },
      billing: { mode: "manual", provider: null, env: "test", currency: "USD" },
      usage: { workspaces: 0, seats: 0 },
      schemaVersion: 1,
    };
    tx.create(slugRef, { agencyId: agencyRef.id, createdAt: FieldValue.serverTimestamp() });
    tx.create(agencyRef, {
      ...agency,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: ctx.uid,
    });
    createInvitationInTx(tx, {
      target: { kind: "agency", agencyId: agencyRef.id, role: "agency_owner" },
      email: input.ownerEmail,
      invitedBy: ctx.uid,
      host: partnersHost,
      requestId: ctx.requestId,
      displayName: input.name,
    });
    audit(
      tx,
      { platform: true },
      {
        action: "agency.created",
        actor: { type: "platform_admin", uid: ctx.uid },
        target: { type: "agency", id: agencyRef.id },
        requestId: ctx.requestId,
      },
    );
    const result = { agencyId: agencyRef.id };
    save(result);
    return result;
  });
}

export interface ProvisionWorkspaceInput {
  /** Required for platform staff; ignored (taken from context) for agency staff. */
  agencyId?: string | undefined;
  name: string;
  slug: string;
  ownerEmail: string;
  idempotencyKey: string;
}

type Provisioner =
  { kind: "platform"; ctx: PlatformContext } | { kind: "agency"; ctx: AgencyContext };

export async function provisionWorkspace(actor: Provisioner, input: ProvisionWorkspaceInput) {
  // Agency staff can never choose another agency (FR-AGY-003).
  const agencyId = actor.kind === "agency" ? actor.ctx.agencyId : input.agencyId;
  if (!agencyId) throw new AppError("VALIDATION", "agency_required", { agencyId: ["Required"] });
  if (actor.kind === "agency") authorizeAgency(actor.ctx, "agency.workspace.create");
  const baseDomain = requiredHost("APP_BASE_DOMAIN");
  const uid = actor.ctx.uid;
  const requestId = actor.ctx.requestId;

  return getDb().runTransaction(async (tx) => {
    const { prior, save } = await idempotent<{ tenantId: string; host: string }>(
      tx,
      uid,
      input.idempotencyKey,
    );
    if (prior) return prior;

    const agencyRef = getDb().doc(`agencies/${agencyId}`);
    const slugRef = getDb().doc(`tenantSlugs/${input.slug}`);
    const host = `${input.slug}.${baseDomain}`;
    const domainRef = getDb().doc(`tenantDomains/${host}`);
    const [agencySnap, slugSnap, domainSnap] = await Promise.all([
      tx.get(agencyRef),
      tx.get(slugRef),
      tx.get(domainRef),
    ]);
    const agency = agencySnap.data() as AgencyDoc | undefined;
    if (!agency || agency.status !== "active") throw new NotFoundError("agency_unavailable");
    if (actor.kind === "agency" && !agency.entitlements.canProvisionWorkspaces) {
      throw new ForbiddenError("agency_cannot_provision");
    }
    if ((agency.usage?.workspaces ?? 0) >= agency.quotas.maxWorkspaces) {
      throw new AppError("PLAN_LIMIT_EXCEEDED", "agency_workspace_quota");
    }
    if (slugSnap.exists || domainSnap.exists) throw new ConflictError("slug_taken");

    const tenantRef = getDb().collection("tenants").doc();
    const tenant: TenantDoc = {
      agencyId,
      name: input.name,
      slug: input.slug,
      status: "active",
      canonicalHost: host,
      planId: "trial",
      billingState: "trialing",
      ownerUid: null,
      branding: {},
      settings: { timezone: "UTC", locale: "en-US", currency: agency.billing.currency },
      schemaVersion: 1,
    };
    tx.create(slugRef, { tenantId: tenantRef.id, createdAt: FieldValue.serverTimestamp() });
    tx.create(tenantRef, { ...tenant, createdAt: FieldValue.serverTimestamp(), createdBy: uid });
    tx.create(domainRef, {
      tenantId: tenantRef.id,
      agencyId,
      type: "platform_subdomain",
      status: "active",
      isCanonical: true,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.create(getDb().doc(`tenants/${tenantRef.id}/pipelines/default`), DEFAULT_PIPELINE);
    tx.create(getDb().doc(`tenants/${tenantRef.id}/usage/current`), { seats: 0, records: 0 });
    tx.create(getDb().doc(`tenants/${tenantRef.id}/billing/subscription`), {
      provider: null,
      planId: "trial",
      status: "trialing",
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(agencyRef, { "usage.workspaces": FieldValue.increment(1) });
    createInvitationInTx(tx, {
      target: { kind: "workspace", tenantId: tenantRef.id, role: "owner" },
      email: input.ownerEmail,
      invitedBy: uid,
      host,
      requestId,
      displayName: input.name,
    });
    const actorRef =
      actor.kind === "platform"
        ? ({ type: "platform_admin", uid } as const)
        : ({ type: "agency_staff", uid } as const);
    for (const scope of [{ tenantId: tenantRef.id }, { agencyId }, { platform: true as const }]) {
      audit(tx, scope, {
        action: "tenant.created",
        actor: actorRef,
        target: { type: "tenant", id: tenantRef.id },
        requestId,
      });
    }
    const result = { tenantId: tenantRef.id, host };
    save(result);
    return result;
  });
}

/** Suspend/reactivate a workspace (FR-TEN-002). Agency staff: own workspaces only. */
export async function setWorkspaceStatus(
  actor: Provisioner,
  tenantId: string,
  status: Extract<LifecycleStatus, "active" | "suspended">,
): Promise<void> {
  if (actor.kind === "agency") authorizeAgency(actor.ctx, "agency.workspace.suspend");
  await getDb().runTransaction(async (tx) => {
    const ref = getDb().doc(`tenants/${tenantId}`);
    const tenant = (await tx.get(ref)).data() as TenantDoc | undefined;
    // Another agency's workspace is indistinguishable from a missing one.
    if (!tenant || (actor.kind === "agency" && tenant.agencyId !== actor.ctx.agencyId)) {
      throw new NotFoundError("tenant_not_found");
    }
    if (tenant.status === status) return;
    if (tenant.status !== "active" && tenant.status !== "suspended") {
      throw new ConflictError(`cannot_change_from_${tenant.status}`);
    }
    tx.update(ref, { status, statusChangedAt: FieldValue.serverTimestamp() });
    const action = status === "suspended" ? "tenant.suspended" : "tenant.reactivated";
    const actorRef =
      actor.kind === "platform"
        ? ({ type: "platform_admin", uid: actor.ctx.uid } as const)
        : ({ type: "agency_staff", uid: actor.ctx.uid } as const);
    for (const scope of [{ tenantId }, { agencyId: tenant.agencyId }]) {
      audit(tx, scope, {
        action,
        actor: actorRef,
        target: { type: "tenant", id: tenantId },
        requestId: actor.ctx.requestId,
      });
    }
  });
}

/** Suspend/reactivate an agency — cascades to all its workspaces via context checks (FR-AGY-001). */
export async function setAgencyStatus(
  ctx: PlatformContext,
  agencyId: string,
  status: Extract<LifecycleStatus, "active" | "suspended">,
): Promise<void> {
  await getDb().runTransaction(async (tx) => {
    const ref = getDb().doc(`agencies/${agencyId}`);
    const agency = (await tx.get(ref)).data() as AgencyDoc | undefined;
    if (!agency) throw new NotFoundError("agency_not_found");
    if (agency.status === status) return;
    tx.update(ref, { status, statusChangedAt: FieldValue.serverTimestamp() });
    audit(
      tx,
      { platform: true },
      {
        action: status === "suspended" ? "agency.suspended" : "agency.reactivated",
        actor: { type: "platform_admin", uid: ctx.uid },
        target: { type: "agency", id: agencyId },
        requestId: ctx.requestId,
      },
    );
  });
}
