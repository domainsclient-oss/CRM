import "server-only";
import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { normalizeHost } from "@crm/shared/hosts";
import { audit, type AuditAction, type AuditEntry, type AuditScope } from "../audit";
import { authorizeAgency, authorizePlatform } from "../authz";
import type { AgencyContext } from "../contexts/agency-context";
import type { PlatformContext } from "../contexts/platform-context";
import { clearTenantCaches } from "../contexts/tenant-context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { getDb } from "../firebase-admin";
import { logger } from "../logger";
import type { TenantDoc, TenantDomainDoc } from "../model";
import { assertSafeId } from "../repositories/base";
import { getServerEnv } from "../server-env";
import { getDomainProviders, type DnsRecord } from "./providers";

// Custom and agency domains (FR-TEN-005, FR-TEN-009, requirements/05 §5.1). A host maps to at most
// one workspace instance-wide: uniqueness is the tenantDomains/{host} document ID. Only `active`
// hosts route (proxy + tenant context); activation requires provider verification + DNS config,
// then the host is added to Firebase Auth authorized domains (R-02).

export type DomainActor =
  { kind: "agency"; ctx: AgencyContext } | { kind: "platform"; ctx: PlatformContext };

export interface DomainView {
  host: string;
  type: TenantDomainDoc["type"];
  status: TenantDomainDoc["status"];
  isCanonical: boolean;
  records: DnsRecord[];
  error: string | null;
}

const VERIFY_TIMEOUT_MS = 72 * 60 * 60 * 1000;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Validate a client-supplied host; ports only in local/test (dev hosts carry them). */
export function validateCustomHost(raw: string): string {
  const env = getServerEnv();
  const host = normalizeHost(
    raw
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, ""),
  );
  const fail = () =>
    new ValidationError({ host: ["Enter a domain like crm.example.com"] }, "bad_host");
  if (!host) throw fail();
  const [name, port] = host.split(":");
  const local = env.APP_ENV === "local" || env.APP_ENV === "test";
  if (!name || (port && !local)) throw fail();
  const labels = name.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || /^\d+$/.test(labels.at(-1)!)) {
    throw fail();
  }
  // Platform hosts are reserved exactly; the workspace base domain also as a suffix.
  const bare = (h: string | undefined) => (h ? h.split(":")[0]!.toLowerCase() : null);
  const exact = [
    env.APP_MARKETING_HOST,
    env.APP_CONSOLE_HOST,
    env.APP_PARTNERS_HOST,
    env.APP_BASE_DOMAIN,
  ]
    .map(bare)
    .filter((h): h is string => Boolean(h));
  const base = bare(env.APP_BASE_DOMAIN);
  if (exact.includes(name) || (base && name.endsWith(`.${base}`))) {
    throw new ValidationError({ host: ["This domain belongs to the platform"] }, "reserved_host");
  }
  return host;
}

interface Scope {
  tenant: TenantDoc;
  tenantId: string;
  auditScopes: AuditScope[];
  actorRef: AuditEntry["actor"];
  requestId: string;
}

async function scopeFor(actor: DomainActor, tenantId: string): Promise<Scope> {
  assertSafeId(tenantId);
  if (actor.kind === "agency") authorizeAgency(actor.ctx, "agency.workspace.domain");
  else authorizePlatform(actor.ctx, "platform.tenant.manage");
  const tenant = (await getDb().doc(`tenants/${tenantId}`).get()).data() as TenantDoc | undefined;
  if (!tenant || (actor.kind === "agency" && tenant.agencyId !== actor.ctx.agencyId)) {
    throw new NotFoundError(); // FR-AGY-003: other agencies' workspaces don't exist
  }
  return {
    tenant,
    tenantId,
    auditScopes:
      actor.kind === "agency"
        ? [{ agencyId: actor.ctx.agencyId }, { tenantId }]
        : [{ platform: true }, { tenantId }],
    actorRef:
      actor.kind === "agency"
        ? { type: "agency_staff", uid: actor.ctx.uid }
        : { type: "platform_admin", uid: actor.ctx.uid },
    requestId: actor.ctx.requestId,
  };
}

function writeAudit(
  writer: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch,
  scope: Pick<Scope, "auditScopes" | "actorRef" | "requestId">,
  action: AuditAction,
  host: string,
  meta: Record<string, string> = {},
) {
  for (const s of scope.auditScopes) {
    audit(writer, s, {
      action,
      actor: scope.actorRef,
      target: { type: "domain", id: host },
      meta,
      requestId: scope.requestId,
    });
  }
}

const view = (host: string, d: DocumentData): DomainView => ({
  host,
  type: d.type,
  status: d.status,
  isCanonical: d.isCanonical === true,
  records: (d.records as DnsRecord[] | undefined) ?? [],
  error: (d.error as string | null | undefined) ?? null,
});

export async function listDomains(actor: DomainActor, tenantId: string): Promise<DomainView[]> {
  await scopeFor(actor, tenantId);
  const snap = await getDb().collection("tenantDomains").where("tenantId", "==", tenantId).get();
  return snap.docs
    .map((d) => view(d.id, d.data()))
    .sort((a, b) => Number(b.isCanonical) - Number(a.isCanonical) || a.host.localeCompare(b.host));
}

/** Step 1: reserve the host and register it with the hosting provider. */
export async function addDomain(
  actor: DomainActor,
  tenantId: string,
  rawHost: string,
  type: "custom" | "agency_subdomain" = "custom",
): Promise<DomainView> {
  const scope = await scopeFor(actor, tenantId);
  const host = validateCustomHost(rawHost);
  const ref = getDb().doc(`tenantDomains/${host}`);
  await getDb().runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) throw new ConflictError("domain_taken");
    tx.create(ref, {
      tenantId,
      agencyId: scope.tenant.agencyId,
      type,
      status: "pending_dns",
      isCanonical: false,
      records: [],
      error: null,
      authDomainSynced: false,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actor.ctx.uid,
      lastCheckedAt: null,
    });
    writeAudit(tx, scope, "domain.added", host, { type });
  });
  const status = await getDomainProviders().domains.add(host);
  await ref.update({
    status: status.error ? "error" : "verifying",
    records: status.records,
    error: status.error,
  });
  return view(host, (await ref.get()).data()!);
}

/** Verification step (button + scheduled job): activate once verified and configured. */
async function checkInternal(
  host: string,
  scope: Pick<Scope, "auditScopes" | "actorRef" | "requestId">,
) {
  const ref = getDb().doc(`tenantDomains/${host}`);
  const doc = (await ref.get()).data();
  if (!doc || doc.status === "active" || doc.type === "platform_subdomain") return doc;
  const providers = getDomainProviders();
  const status = await providers.domains.status(host);
  const createdAt = (doc.createdAt as Timestamp | undefined)?.toMillis() ?? Date.now();
  if (status.verified && status.configured) {
    await providers.auth.add(host.split(":")[0]!);
    const batch = getDb().batch();
    batch.update(ref, {
      status: "active",
      records: status.records,
      error: null,
      authDomainSynced: true,
      activatedAt: FieldValue.serverTimestamp(),
      lastCheckedAt: FieldValue.serverTimestamp(),
    });
    writeAudit(batch, scope, "domain.activated", host);
    await batch.commit();
    clearTenantCaches();
  } else {
    const timedOut = Date.now() - createdAt > VERIFY_TIMEOUT_MS;
    const error = status.error ?? (timedOut ? "verification_timeout" : null);
    await ref.update({
      status: error ? "error" : "verifying",
      records: status.records.length ? status.records : doc.records,
      error,
      lastCheckedAt: FieldValue.serverTimestamp(),
    });
  }
  return (await ref.get()).data();
}

export async function checkDomain(
  actor: DomainActor,
  tenantId: string,
  host: string,
): Promise<DomainView> {
  const scope = await scopeFor(actor, tenantId);
  const doc = (await getDb().doc(`tenantDomains/${host}`).get()).data();
  if (!doc || doc.tenantId !== tenantId) throw new NotFoundError();
  return view(host, (await checkInternal(host, scope))!);
}

/** Scheduled job body (every 10 minutes; Functions in T-01-09). Returns hosts checked. */
export async function runDomainChecks(): Promise<number> {
  let checked = 0;
  for (const status of ["pending_dns", "verifying"] as const) {
    const snap = await getDb()
      .collection("tenantDomains")
      .where("status", "==", status)
      .limit(100)
      .get();
    for (const d of snap.docs) {
      const tenantId = d.get("tenantId") as string | null;
      await checkInternal(d.id, {
        auditScopes: tenantId ? [{ tenantId }] : [{ agencyId: d.get("agencyId") as string }],
        actorRef: { type: "system" },
        requestId: "job_domain_check",
      }).catch((error: unknown) =>
        logger.error("domain_check_failed", {
          error: error instanceof Error ? error.message : "x",
        }),
      );
      checked++;
    }
  }
  return checked;
}

/** Canonical switch (05 §5.1 step 5): links, emails, and the fallback redirect use this host. */
export async function setCanonicalDomain(actor: DomainActor, tenantId: string, host: string) {
  const scope = await scopeFor(actor, tenantId);
  await getDb().runTransaction(async (tx) => {
    const target = getDb().doc(`tenantDomains/${host}`);
    const doc = (await tx.get(target)).data();
    if (!doc || doc.tenantId !== tenantId) throw new NotFoundError();
    if (doc.status !== "active") throw new ConflictError("domain_not_active");
    const others = await tx.get(
      getDb().collection("tenantDomains").where("tenantId", "==", tenantId),
    );
    for (const o of others.docs)
      if (o.id !== host && o.get("isCanonical")) tx.update(o.ref, { isCanonical: false });
    tx.update(target, { isCanonical: true });
    tx.update(getDb().doc(`tenants/${tenantId}`), { canonicalHost: host });
    writeAudit(tx, scope, "domain.canonical_changed", host, { from: scope.tenant.canonicalHost });
  });
  clearTenantCaches();
  return { ok: true };
}

/** Removal (05 §5.1 step 6). The platform fallback host can't be removed. */
export async function removeDomain(actor: DomainActor, tenantId: string, host: string) {
  const scope = await scopeFor(actor, tenantId);
  const ref = getDb().doc(`tenantDomains/${host}`);
  const doc = (await ref.get()).data();
  if (!doc || doc.tenantId !== tenantId) throw new NotFoundError();
  if (doc.type === "platform_subdomain") throw new ConflictError("fallback_host");
  if (doc.isCanonical) {
    const fallback = (
      await getDb()
        .collection("tenantDomains")
        .where("tenantId", "==", tenantId)
        .where("type", "==", "platform_subdomain")
        .limit(1)
        .get()
    ).docs[0];
    if (!fallback) throw new ConflictError("no_fallback_host");
    await setCanonicalDomain(actor, tenantId, fallback.id);
  }
  const providers = getDomainProviders();
  await providers.domains.remove(host);
  if (doc.authDomainSynced) await providers.auth.remove(host.split(":")[0]!);
  const batch = getDb().batch();
  batch.delete(ref);
  writeAudit(batch, scope, "domain.removed", host);
  await batch.commit();
  clearTenantCaches();
  return { ok: true };
}

/** FR-TEN-009: serve a workspace at `{slug}.{agency base domain}` once the base is set. */
export async function addAgencySubdomain(
  actor: { kind: "agency"; ctx: AgencyContext },
  tenantId: string,
) {
  const base = actor.ctx.agency.baseDomain as string | null | undefined;
  if (!base) throw new ConflictError("no_base_domain");
  const tenant = (await scopeFor(actor, tenantId)).tenant;
  return addDomain(actor, tenantId, `${tenant.slug}.${base}`, "agency_subdomain");
}

/** Agency base domain (stored on the agency; workspace hosts are added per workspace). */
export async function setAgencyBaseDomain(ctx: AgencyContext, rawHost: string | null) {
  authorizeAgency(ctx, "agency.workspace.domain");
  const host = rawHost ? validateCustomHost(rawHost) : null;
  const batch = getDb().batch();
  batch.update(getDb().doc(`agencies/${ctx.agencyId}`), { baseDomain: host });
  audit(
    batch,
    { agencyId: ctx.agencyId },
    {
      action: "domain.added",
      actor: { type: "agency_staff", uid: ctx.uid },
      target: { type: "agency_base_domain", id: host ?? "none" },
      requestId: ctx.requestId,
    },
  );
  await batch.commit();
  clearTenantCaches();
  return { baseDomain: host };
}
