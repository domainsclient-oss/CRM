import { describe, expect, it } from "vitest";
import { WORKSPACE_ROLES, type WorkspaceRole } from "@crm/shared/permissions";
import {
  assertCanChangeRole,
  assertCanInviteRole,
  authorize,
  authorizeAgency,
  authorizePlatform,
  canActOnRecord,
} from "./authz";
import { ForbiddenError } from "./errors";

const actor = (role: WorkspaceRole, uid = `u_${role}`) => ({ uid, role });

describe("authorize", () => {
  it("returns the scope for granted permissions", () => {
    expect(authorize(actor("manager"), "record.update")).toBe("all");
    expect(authorize(actor("member"), "record.update")).toBe("own");
  });

  it("throws ForbiddenError for denied permissions", () => {
    expect(() => authorize(actor("viewer"), "record.create")).toThrow(ForbiddenError);
    expect(() => authorize(actor("admin"), "tenant.delete")).toThrow(ForbiddenError);
  });
});

describe("canActOnRecord (TC-RBAC-004)", () => {
  const record = { ownerUid: "u_raj" };
  it("members act only on their own records", () => {
    expect(canActOnRecord(actor("member", "u_raj"), "record.update", record)).toBe(true);
    expect(canActOnRecord(actor("member", "u_lena"), "record.update", record)).toBe(false);
    expect(canActOnRecord(actor("member", "u_lena"), "record.read", record)).toBe(false);
  });
  it("managers act on any record; viewers on none", () => {
    expect(canActOnRecord(actor("manager"), "record.delete", record)).toBe(true);
    expect(canActOnRecord(actor("viewer"), "record.update", record)).toBe(false);
  });
});

describe("assertCanChangeRole (TC-RBAC-003)", () => {
  const allowed: Array<[WorkspaceRole, WorkspaceRole, WorkspaceRole]> = [
    ["owner", "admin", "manager"],
    ["owner", "member", "admin"],
    ["admin", "member", "manager"],
    ["admin", "viewer", "member"],
  ];
  it.each(allowed)("%s may change %s → %s", (a, t, n) => {
    expect(() => assertCanChangeRole(actor(a), actor(t), n)).not.toThrow();
  });

  it("nobody changes their own role", () => {
    for (const role of WORKSPACE_ROLES) {
      expect(() => assertCanChangeRole(actor(role, "u_x"), actor(role, "u_x"), "viewer")).toThrow();
    }
  });

  it("nobody promotes to owner or demotes the owner", () => {
    expect(() => assertCanChangeRole(actor("owner"), actor("admin"), "owner")).toThrow();
    expect(() => assertCanChangeRole(actor("admin"), actor("owner"), "member")).toThrow();
  });

  it("admins cannot create or modify admins", () => {
    expect(() => assertCanChangeRole(actor("admin", "a1"), actor("member"), "admin")).toThrow();
    expect(() =>
      assertCanChangeRole(actor("admin", "a1"), actor("admin", "a2"), "member"),
    ).toThrow();
  });

  it("managers, members and viewers cannot change roles", () => {
    for (const role of ["manager", "member", "viewer"] as const) {
      expect(() => assertCanChangeRole(actor(role), actor("viewer"), "member")).toThrow();
    }
  });
});

describe("assertCanInviteRole (TC-RBAC-001)", () => {
  it("never invites an owner from the workspace", () => {
    expect(() => assertCanInviteRole(actor("owner"), "owner")).toThrow();
  });
  it("owners invite admins; admins cannot", () => {
    expect(() => assertCanInviteRole(actor("owner"), "admin")).not.toThrow();
    expect(() => assertCanInviteRole(actor("admin"), "admin")).toThrow();
    expect(() => assertCanInviteRole(actor("admin"), "member")).not.toThrow();
  });
  it("managers cannot invite", () => {
    expect(() => assertCanInviteRole(actor("manager"), "viewer")).toThrow();
  });
});

describe("agency and platform authorization", () => {
  it("enforces agency role grants", () => {
    expect(() => authorizeAgency({ role: "agency_admin" }, "agency.staff.manage")).toThrow();
    expect(() => authorizeAgency({ role: "agency_owner" }, "agency.staff.manage")).not.toThrow();
  });
  it("platform support cannot manage", () => {
    expect(() => authorizePlatform({ role: "support" }, "platform.tenant.manage")).toThrow();
  });
});
