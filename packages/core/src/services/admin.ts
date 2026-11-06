import "server-only";
import { authorizeAgency, authorizePlatform } from "../authz";
import type { AgencyContext } from "../contexts/agency-context";
import type { PlatformContext } from "../contexts/platform-context";
import { getDb } from "../firebase-admin";
import type { AgencyDoc, TenantDoc } from "../model";

// Console listings (FR-AGY-005, T-02-07). Metadata only — these functions never touch
// workspace CRM subcollections (A-09, FR-AGY-002).

export interface AgencySummary {
  id: string;
  name: string;
  slug: string;
  status: AgencyDoc["status"];
  workspaces: number;
  maxWorkspaces: number;
  canProvisionWorkspaces: boolean;
}

export interface WorkspaceAdminSummary {
  id: string;
  agencyId: string;
  name: string;
  slug: string;
  status: TenantDoc["status"];
  host: string;
  planId: string;
}

const LIMIT = 500;

export async function listAgencies(ctx: PlatformContext): Promise<AgencySummary[]> {
  authorizePlatform(ctx, "platform.agency.read");
  const snap = await getDb().collection("agencies").limit(LIMIT).get();
  return snap.docs
    .map((d) => {
      const a = d.data() as AgencyDoc;
      return {
        id: d.id,
        name: a.name,
        slug: a.slug,
        status: a.status,
        workspaces: a.usage?.workspaces ?? 0,
        maxWorkspaces: a.quotas.maxWorkspaces,
        canProvisionWorkspaces: a.entitlements.canProvisionWorkspaces,
      };
    })
    .sort((x, y) => x.name.localeCompare(y.name));
}

function toSummary(id: string, t: TenantDoc): WorkspaceAdminSummary {
  return {
    id,
    agencyId: t.agencyId,
    name: t.name,
    slug: t.slug,
    status: t.status,
    host: t.canonicalHost,
    planId: t.planId,
  };
}

export async function listAllWorkspaces(ctx: PlatformContext): Promise<WorkspaceAdminSummary[]> {
  authorizePlatform(ctx, "platform.tenant.read");
  const snap = await getDb().collection("tenants").limit(LIMIT).get();
  return snap.docs
    .map((d) => toSummary(d.id, d.data() as TenantDoc))
    .sort((x, y) => x.name.localeCompare(y.name));
}

/** Only this agency's workspaces; agencyId comes from the staff context, never input. */
export async function listAgencyWorkspaces(ctx: AgencyContext): Promise<WorkspaceAdminSummary[]> {
  authorizeAgency(ctx, "agency.workspace.read");
  // Single-field equality (automatic index); sorted in memory to avoid a composite index.
  const snap = await getDb()
    .collection("tenants")
    .where("agencyId", "==", ctx.agencyId)
    .limit(LIMIT)
    .get();
  return snap.docs
    .map((d) => toSummary(d.id, d.data() as TenantDoc))
    .sort((x, y) => x.name.localeCompare(y.name));
}
