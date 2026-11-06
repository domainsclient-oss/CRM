import "server-only";
import { isWorkspaceRole, type WorkspaceRole } from "@crm/shared/permissions";
import { getDb } from "../firebase-admin";
import type { MemberDoc, TenantDoc, UserDoc } from "../model";

// Workspace switcher data (FR-TEN-008, T-02-06). users/{uid}.tenantIds is only a hint;
// each entry is re-checked against an active membership and an active workspace.

export interface WorkspaceSummary {
  tenantId: string;
  name: string;
  host: string;
  role: WorkspaceRole;
}

export async function listUserWorkspaces(uid: string): Promise<WorkspaceSummary[]> {
  const user = (await getDb().doc(`users/${uid}`).get()).data() as UserDoc | undefined;
  const ids = (user?.tenantIds ?? []).filter((id) => typeof id === "string").slice(0, 50);
  const rows = await Promise.all(
    ids.map(async (tenantId) => {
      const [tenantSnap, memberSnap] = await Promise.all([
        getDb().doc(`tenants/${tenantId}`).get(),
        getDb().doc(`tenants/${tenantId}/members/${uid}`).get(),
      ]);
      const tenant = tenantSnap.data() as TenantDoc | undefined;
      const member = memberSnap.data() as MemberDoc | undefined;
      if (!tenant || tenant.status !== "active") return null;
      if (!member || member.status !== "active" || !isWorkspaceRole(member.role)) return null;
      return { tenantId, name: tenant.name, host: tenant.canonicalHost, role: member.role };
    }),
  );
  return rows
    .filter((row): row is WorkspaceSummary => row !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}
