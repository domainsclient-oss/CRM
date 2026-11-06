// Permission model (requirements/01 §4.3, §24; FR-RBAC-002, FR-RBAC-004, FR-AGY-002).
// Versioned in code. The UI may use this to hide actions, but enforcement is server-side.

export const WORKSPACE_ROLES = ["owner", "admin", "manager", "member", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const AGENCY_ROLES = ["agency_owner", "agency_admin"] as const;
export type AgencyRole = (typeof AGENCY_ROLES)[number];

export const PLATFORM_ROLES = ["superadmin", "support"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/** "all" = any record in the workspace; "own" = records the user owns / is assigned. */
export type Scope = "all" | "own";

export const WORKSPACE_PERMISSIONS = [
  "record.read",
  "record.create",
  "record.update",
  "record.delete",
  "record.restore",
  "record.reassign",
  "record.export",
  "lead.convert",
  "pipeline.manage",
  "report.read",
  "report.export",
  "import.run",
  "member.read",
  "member.invite",
  "member.update",
  "member.remove",
  "member.forceSignOut",
  "settings.manage",
  "branding.manage",
  "audit.read",
  "privacy.manage",
  "plan.read",
  "billing.read",
  "billing.manage",
  "tenant.export",
  "tenant.delete",
  "tenant.transferOwnership",
] as const;
export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];

type Grants<P extends string> = Partial<Record<P, Scope>>;

const all = <P extends string>(...perms: P[]): Grants<P> =>
  Object.fromEntries(perms.map((p) => [p, "all"])) as Grants<P>;

const MANAGER: Grants<WorkspacePermission> = all(
  "record.read",
  "record.create",
  "record.update",
  "record.delete",
  "record.restore",
  "record.reassign",
  "record.export",
  "lead.convert",
  "report.read",
  "report.export",
  "import.run",
  "member.read",
);

const ADMIN: Grants<WorkspacePermission> = {
  ...MANAGER,
  ...all(
    "pipeline.manage",
    "member.invite",
    "member.update",
    "member.remove",
    "member.forceSignOut",
    "settings.manage",
    "branding.manage",
    "audit.read",
    "privacy.manage",
    "plan.read",
    "billing.read",
  ),
};

export const WORKSPACE_ROLE_GRANTS: Record<WorkspaceRole, Grants<WorkspacePermission>> = {
  owner: {
    ...ADMIN,
    ...all("billing.manage", "tenant.export", "tenant.delete", "tenant.transferOwnership"),
  },
  admin: ADMIN,
  manager: MANAGER,
  // [CONFIRMED] Members see and act on only their own records.
  member: {
    "record.read": "own",
    "record.create": "all",
    "record.update": "own",
    "record.delete": "own",
    "lead.convert": "own",
    "report.read": "own",
    "member.read": "all",
  },
  viewer: all("record.read", "report.read", "member.read"),
};

export const AGENCY_PERMISSIONS = [
  "agency.workspace.read",
  "agency.workspace.create",
  "agency.workspace.suspend",
  "agency.workspace.branding",
  "agency.workspace.domain",
  "agency.workspace.inviteOwner",
  "agency.branding.manage",
  "agency.billing.manage",
  "agency.staff.manage",
] as const;
export type AgencyPermission = (typeof AGENCY_PERMISSIONS)[number];

const AGENCY_ADMIN: Grants<AgencyPermission> = all(
  "agency.workspace.read",
  "agency.workspace.create", // also requires agency entitlement canProvisionWorkspaces
  "agency.workspace.suspend",
  "agency.workspace.branding",
  "agency.workspace.domain",
  "agency.workspace.inviteOwner",
  "agency.branding.manage",
);

export const AGENCY_ROLE_GRANTS: Record<AgencyRole, Grants<AgencyPermission>> = {
  agency_owner: { ...AGENCY_ADMIN, ...all("agency.billing.manage", "agency.staff.manage") },
  agency_admin: AGENCY_ADMIN,
};

export const PLATFORM_PERMISSIONS = [
  "platform.agency.read",
  "platform.agency.manage",
  "platform.tenant.read",
  "platform.tenant.manage",
  "platform.plan.manage",
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export const PLATFORM_ROLE_GRANTS: Record<PlatformRole, Grants<PlatformPermission>> = {
  superadmin: all(...PLATFORM_PERMISSIONS),
  support: all("platform.agency.read", "platform.tenant.read"),
};

/** Scope granted, or null when the role lacks the permission. */
export function workspaceScope(role: WorkspaceRole, permission: WorkspacePermission): Scope | null {
  // Unknown roles (e.g. a corrupted document) get nothing rather than a TypeError.
  return Object.hasOwn(WORKSPACE_ROLE_GRANTS, role)
    ? (WORKSPACE_ROLE_GRANTS[role][permission] ?? null)
    : null;
}

export function agencyAllows(role: AgencyRole, permission: AgencyPermission): boolean {
  return (
    Object.hasOwn(AGENCY_ROLE_GRANTS, role) && AGENCY_ROLE_GRANTS[role][permission] !== undefined
  );
}

export function platformAllows(role: PlatformRole, permission: PlatformPermission): boolean {
  return (
    Object.hasOwn(PLATFORM_ROLE_GRANTS, role) &&
    PLATFORM_ROLE_GRANTS[role][permission] !== undefined
  );
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}
export function isAgencyRole(value: unknown): value is AgencyRole {
  return typeof value === "string" && (AGENCY_ROLES as readonly string[]).includes(value);
}
export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === "string" && (PLATFORM_ROLES as readonly string[]).includes(value);
}

/** Roles an actor may grant via invitation (FR-RBAC-001). Owners are never invited. */
export function invitableRoles(actor: WorkspaceRole): WorkspaceRole[] {
  if (actor === "owner") return ["admin", "manager", "member", "viewer"];
  if (actor === "admin") return ["manager", "member", "viewer"];
  return [];
}

/**
 * Roles an actor may set on a target (FR-RBAC-003). Empty = the target's role can't be
 * changed by this actor. Self-changes are excluded by the caller (uid comparison).
 */
export function assignableRoles(actor: WorkspaceRole, target: WorkspaceRole): WorkspaceRole[] {
  if (target === "owner") return [];
  if (actor === "owner") return ["admin", "manager", "member", "viewer"];
  if (actor === "admin" && target !== "admin") return ["manager", "member", "viewer"];
  return [];
}
