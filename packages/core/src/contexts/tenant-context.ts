import "server-only";
import { normalizeHost } from "@crm/shared/hosts";
import { isWorkspaceRole, type WorkspaceRole } from "@crm/shared/permissions";
import { AppError, ForbiddenError, NotFoundError, UnauthenticatedError } from "../errors";
import { getDb } from "../firebase-admin";
import { logger, type Logger } from "../logger";
import type { AgencyDoc, MemberDoc, TenantDoc, TenantDomainDoc } from "../model";
import { getServerEnv } from "../server-env";
import { verifySession, type Session } from "../session";
import { TtlCache } from "../ttl-cache";

// Workspace request context (requirements/02 §6.1). The workspace comes from the
// verified host mapping; access comes only from an active membership document.

export interface TenantContext {
  tenantId: string;
  agencyId: string;
  uid: string;
  role: WorkspaceRole;
  session: Session;
  tenant: TenantDoc;
  requestId: string;
  log: Logger;
}

interface WorkspaceRef {
  tenantId: string;
  agencyId: string;
  type: TenantDomainDoc["type"];
}

const ttlMs = () => getServerEnv().APP_TENANT_CACHE_TTL_SECONDS * 1000;
let hostCache: TtlCache<WorkspaceRef | null> | undefined;
let docCache: TtlCache<TenantDoc | AgencyDoc | null> | undefined;
const hosts = () => (hostCache ??= new TtlCache(ttlMs()));
const docs = () => (docCache ??= new TtlCache(ttlMs()));

/** Test hook: config caches would otherwise hide changes made between test cases. */
export function clearTenantCaches(): void {
  hostCache?.clear();
  docCache?.clear();
}

/** Resolve an active host mapping. Unknown, unverified, or malformed hosts → null. */
export async function resolveWorkspaceByHost(rawHost: string): Promise<WorkspaceRef | null> {
  const host = normalizeHost(rawHost);
  if (!host) return null;
  const cached = hosts().get(host);
  if (cached !== undefined) return cached;

  const snap = await getDb().doc(`tenantDomains/${host}`).get();
  const data = snap.data() as TenantDomainDoc | undefined;
  const ref =
    data && data.status === "active" && data.tenantId
      ? { tenantId: data.tenantId, agencyId: data.agencyId, type: data.type }
      : null;
  hosts().set(host, ref);
  return ref;
}

async function loadCached<T extends TenantDoc | AgencyDoc>(path: string): Promise<T | null> {
  const cached = docs().get(path);
  if (cached !== undefined) return cached as T | null;
  const snap = await getDb().doc(path).get();
  const value = (snap.exists ? snap.data() : null) as T | null;
  docs().set(path, value);
  return value;
}

/**
 * Fallback-host redirect (FR-TEN-009 AC3, 05 §5.1 step 5): a workspace's platform subdomain
 * 301-redirects to its canonical host once another host is canonical. Null = serve here.
 */
export async function canonicalRedirectHost(rawHost: string): Promise<string | null> {
  const host = normalizeHost(rawHost);
  const ref = host ? await resolveWorkspaceByHost(host) : null;
  if (!host || !ref || ref.type !== "platform_subdomain") return null;
  const tenant = await loadCached<TenantDoc>(`tenants/${ref.tenantId}`);
  const canonical = tenant?.canonicalHost ? normalizeHost(tenant.canonicalHost) : null;
  return canonical && canonical !== host ? canonical : null;
}

/** Cached config docs (≤ TTL old) for branding/config resolution. */
export const loadTenantDoc = (tenantId: string) => loadCached<TenantDoc>(`tenants/${tenantId}`);
export const loadAgencyDoc = (agencyId: string) => loadCached<AgencyDoc>(`agencies/${agencyId}`);

/** Workspace + agency must both be active; suspension takes effect within the cache TTL. */
export async function loadActiveWorkspace(
  ref: WorkspaceRef,
  opts: { allowPendingDeletion?: boolean } = {},
): Promise<TenantDoc> {
  const [tenant, agency] = await Promise.all([
    loadCached<TenantDoc>(`tenants/${ref.tenantId}`),
    loadCached<AgencyDoc>(`agencies/${ref.agencyId}`),
  ]);
  if (!tenant || tenant.agencyId !== ref.agencyId) throw new NotFoundError("tenant_missing");
  const usable =
    tenant.status === "active" ||
    (opts.allowPendingDeletion && tenant.status === "pending_deletion");
  if (!usable || !agency || agency.status !== "active") {
    throw new AppError("TENANT_SUSPENDED", `tenant=${tenant.status} agency=${agency?.status}`);
  }
  return tenant;
}

/** Active membership — read fresh on every request (never cached; role changes are immediate). */
export async function loadMembership(tenantId: string, uid: string): Promise<MemberDoc | null> {
  const snap = await getDb().doc(`tenants/${tenantId}/members/${uid}`).get();
  const member = snap.data() as MemberDoc | undefined;
  if (!member || member.status !== "active" || !isWorkspaceRole(member.role)) return null;
  return member;
}

export async function requireTenantContext(input: {
  host: string;
  sessionCookie: string | undefined;
  requestId: string;
}): Promise<TenantContext> {
  const ref = await resolveWorkspaceByHost(input.host);
  if (!ref) throw new NotFoundError("unknown_host");

  const session = await verifySession(input.sessionCookie, {
    kind: "workspace",
    host: input.host,
  });
  if (!session) throw new UnauthenticatedError();

  const tenant = await loadActiveWorkspace(ref, { allowPendingDeletion: true });
  const member = await loadMembership(ref.tenantId, session.uid);
  if (!member) throw new ForbiddenError("no_membership");
  // Scheduled for deletion (FR-TEN-006 AC2): only the Owner gets in, and only to cancel.
  if (tenant.status === "pending_deletion" && member.role !== "owner") {
    throw new AppError("TENANT_SUSPENDED", "pending_deletion");
  }

  return {
    tenantId: ref.tenantId,
    agencyId: ref.agencyId,
    uid: session.uid,
    role: member.role,
    session,
    tenant,
    requestId: input.requestId,
    log: logger.child({ requestId: input.requestId, tenantId: ref.tenantId, uid: session.uid }),
  };
}

/**
 * Public branding for login/invite pages (FR-PUB-003): the workspace display name only —
 * never members, counts, or status details. Null for unknown/unverified hosts.
 */
export async function getPublicWorkspaceName(host: string): Promise<string | null> {
  const ref = await resolveWorkspaceByHost(host);
  if (!ref) return null;
  const tenant = await loadCached<TenantDoc>(`tenants/${ref.tenantId}`);
  return tenant && (tenant.status === "active" || tenant.status === "pending_deletion")
    ? tenant.name
    : null;
}
