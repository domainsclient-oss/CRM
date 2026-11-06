import "server-only";
import {
  agencyAllows,
  assignableRoles,
  invitableRoles,
  platformAllows,
  workspaceScope,
  type AgencyPermission,
  type AgencyRole,
  type PlatformPermission,
  type PlatformRole,
  type Scope,
  type WorkspacePermission,
  type WorkspaceRole,
} from "@crm/shared/permissions";
import { ForbiddenError } from "./errors";

// Authorization checks (requirements/04 §5). Contexts are built server-side only.

export interface WorkspaceActor {
  uid: string;
  role: WorkspaceRole;
}

/** Throws ForbiddenError unless the role grants the permission; returns its scope. */
export function authorize(actor: WorkspaceActor, permission: WorkspacePermission): Scope {
  const scope = workspaceScope(actor.role, permission);
  if (!scope) throw new ForbiddenError(`${actor.role} lacks ${permission}`);
  return scope;
}

/** Record-level check for "own"-scoped permissions (FR-RBAC-004). */
export function canActOnRecord(
  actor: WorkspaceActor,
  permission: WorkspacePermission,
  record: { ownerUid: string },
): boolean {
  const scope = workspaceScope(actor.role, permission);
  if (scope === "all") return true;
  if (scope === "own") return record.ownerUid === actor.uid;
  return false;
}

export function authorizeAgency(actor: { role: AgencyRole }, permission: AgencyPermission): void {
  if (!agencyAllows(actor.role, permission)) {
    throw new ForbiddenError(`${actor.role} lacks ${permission}`);
  }
}

export function authorizePlatform(
  actor: { role: PlatformRole },
  permission: PlatformPermission,
): void {
  if (!platformAllows(actor.role, permission)) {
    throw new ForbiddenError(`${actor.role} lacks ${permission}`);
  }
}

/** Role-change guard (FR-RBAC-003). Ownership moves only via transferOwnership. */
export function assertCanChangeRole(
  actor: WorkspaceActor,
  target: WorkspaceActor,
  newRole: WorkspaceRole,
): void {
  if (target.uid === actor.uid) throw new ForbiddenError("self_role_change");
  if (newRole === "owner") throw new ForbiddenError("use_transfer_ownership");
  if (!assignableRoles(actor.role, target.role).includes(newRole)) {
    throw new ForbiddenError("role_change_not_allowed");
  }
}

/** Who may invite which role (FR-RBAC-001). Owners are never invited from the workspace. */
export function assertCanInviteRole(actor: WorkspaceActor, role: WorkspaceRole): void {
  if (!invitableRoles(actor.role).includes(role)) throw new ForbiddenError("invite_not_allowed");
}
