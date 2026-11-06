import { describe, expect, it } from "vitest";
import {
  AGENCY_PERMISSIONS,
  AGENCY_ROLES,
  PLATFORM_PERMISSIONS,
  WORKSPACE_PERMISSIONS,
  WORKSPACE_ROLES,
  agencyAllows,
  platformAllows,
  workspaceScope,
  type Scope,
  type WorkspacePermission,
  type WorkspaceRole,
} from "./permissions";

// TC-RBAC-002: the full role × permission table from requirements/01 §4.3.
// Columns: owner, admin, manager, member, viewer. "-" = denied.
type Cell = Scope | "-";
const MATRIX: Record<WorkspacePermission, [Cell, Cell, Cell, Cell, Cell]> = {
  "record.read": ["all", "all", "all", "own", "all"],
  "record.create": ["all", "all", "all", "all", "-"],
  "record.update": ["all", "all", "all", "own", "-"],
  "record.delete": ["all", "all", "all", "own", "-"],
  "record.restore": ["all", "all", "all", "-", "-"],
  "record.reassign": ["all", "all", "all", "-", "-"],
  "record.export": ["all", "all", "all", "-", "-"],
  "lead.convert": ["all", "all", "all", "own", "-"],
  "pipeline.manage": ["all", "all", "-", "-", "-"],
  "report.read": ["all", "all", "all", "own", "all"],
  "report.export": ["all", "all", "all", "-", "-"],
  "import.run": ["all", "all", "all", "-", "-"],
  "member.read": ["all", "all", "all", "all", "all"],
  "member.invite": ["all", "all", "-", "-", "-"],
  "member.update": ["all", "all", "-", "-", "-"],
  "member.remove": ["all", "all", "-", "-", "-"],
  "member.forceSignOut": ["all", "all", "-", "-", "-"],
  "settings.manage": ["all", "all", "-", "-", "-"],
  "branding.manage": ["all", "all", "-", "-", "-"],
  "audit.read": ["all", "all", "-", "-", "-"],
  "privacy.manage": ["all", "all", "-", "-", "-"],
  "plan.read": ["all", "all", "-", "-", "-"],
  "billing.read": ["all", "all", "-", "-", "-"],
  "billing.manage": ["all", "-", "-", "-", "-"],
  "tenant.export": ["all", "-", "-", "-", "-"],
  "tenant.delete": ["all", "-", "-", "-", "-"],
  "tenant.transferOwnership": ["all", "-", "-", "-", "-"],
};

describe("workspace permission matrix (TC-RBAC-002)", () => {
  it("covers every declared permission", () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...WORKSPACE_PERMISSIONS].sort());
  });

  for (const permission of WORKSPACE_PERMISSIONS) {
    WORKSPACE_ROLES.forEach((role: WorkspaceRole, i) => {
      const expected = MATRIX[permission][i];
      it(`${role} → ${permission} = ${expected}`, () => {
        expect(workspaceScope(role, permission) ?? "-").toBe(expected);
      });
    });
  }

  it("members never get workspace-wide record or report access (FR-RBAC-004)", () => {
    const recordAccess = WORKSPACE_PERMISSIONS.filter(
      (p) =>
        (p.startsWith("record.") || p.startsWith("report.") || p === "lead.convert") &&
        p !== "record.create",
    );
    for (const permission of recordAccess) {
      expect(workspaceScope("member", permission), permission).not.toBe("all");
    }
  });

  it("viewers cannot mutate anything", () => {
    const mutating = WORKSPACE_PERMISSIONS.filter(
      (p) => !["record.read", "report.read", "member.read"].includes(p),
    );
    for (const p of mutating) expect(workspaceScope("viewer", p)).toBeNull();
  });
});

describe("agency and platform permissions", () => {
  it("only agency owners manage billing and staff", () => {
    expect(agencyAllows("agency_owner", "agency.billing.manage")).toBe(true);
    expect(agencyAllows("agency_admin", "agency.billing.manage")).toBe(false);
    expect(agencyAllows("agency_admin", "agency.staff.manage")).toBe(false);
  });

  it("agency roles grant no workspace CRM permissions (FR-AGY-002)", () => {
    for (const role of AGENCY_ROLES) {
      for (const p of AGENCY_PERMISSIONS) expect(p.startsWith("agency.")).toBe(true);
      expect(role.startsWith("agency_")).toBe(true);
    }
  });

  it("platform support is read-only", () => {
    for (const p of PLATFORM_PERMISSIONS) {
      expect(platformAllows("support", p)).toBe(p.endsWith(".read"));
      expect(platformAllows("superadmin", p)).toBe(true);
    }
  });
});

describe("unknown roles fail closed (T-09-01)", () => {
  it.each(["", "admin2", "__proto__", "constructor", "toString"])(
    "grants nothing to %j",
    (role) => {
      expect(workspaceScope(role as never, "record.read")).toBeNull();
      expect(agencyAllows(role as never, "agency.workspace.read")).toBe(false);
      expect(platformAllows(role as never, "platform.agency.read")).toBe(false);
    },
  );
});
