import { beforeEach, describe, expect, it } from "vitest";
import { AGENCIES, WORKSPACES, buildAgency } from "@crm/testing/fixtures";
import { createUser, resetEmulators, seedTenancy } from "@crm/testing/seed";
import type { AgencyContext } from "../contexts/agency-context";
import type { PlatformContext } from "../contexts/platform-context";
import { clearTenantCaches } from "../contexts/tenant-context";
import { getAdminAuth, getDb } from "../firebase-admin";
import { logger } from "../logger";
import { MemoryRateLimiter, setRateLimiter } from "../rate-limit";
import { listAgencies, listAgencyWorkspaces, listAllWorkspaces } from "./admin";
import {
  agencyUsageReport,
  getWorkspaceDetail,
  inviteStaff,
  listStaff,
  usageReportCsv,
} from "./agency-admin";

// Console read models (FR-AGY-001/002/003/006, FR-PLAT-*): platform sees everything; agency
// staff only their own agency's workspaces and staff.

const platform: PlatformContext = {
  uid: "u_ops",
  role: "superadmin",
  session: {} as never,
  requestId: "r",
  log: logger,
};
function agency(
  key: keyof typeof AGENCIES,
  role: AgencyContext["role"] = "agency_owner",
): AgencyContext {
  return {
    agencyId: AGENCIES[key].id,
    uid: AGENCIES[key].ownerUid,
    role,
    session: {} as never,
    agency: buildAgency(key) as never,
    requestId: "r",
    log: logger,
  };
}

beforeEach(async () => {
  await resetEmulators();
  await seedTenancy(getDb());
  setRateLimiter(new MemoryRateLimiter());
  clearTenantCaches();
});

describe("platform lists", () => {
  it("lists every agency and workspace, sorted by name", async () => {
    const agencies = await listAgencies(platform);
    expect(agencies.map((a) => a.id).sort()).toEqual(
      Object.values(AGENCIES)
        .map((a) => a.id)
        .sort(),
    );
    const names = agencies.map((a) => a.name);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
    expect((await listAllWorkspaces(platform)).length).toBe(Object.keys(WORKSPACES).length);
  });

  it("fails closed for roles that aren't in the permission matrix", async () => {
    await expect(listAgencies({ ...platform, role: "nonexistent" as never })).rejects.toMatchObject(
      {
        code: "FORBIDDEN",
      },
    );
  });

  it("returns workspace detail for its own workspace; others don't exist", async () => {
    const own = Object.values(WORKSPACES).find((w) => w.agencyId === AGENCIES.agencyOne.id)!;
    const other = Object.values(WORKSPACES).find((w) => w.agencyId !== AGENCIES.agencyOne.id)!;
    const detail = await getWorkspaceDetail({ kind: "agency", ctx: agency("agencyOne") }, own.id);
    expect(detail).toMatchObject({ id: own.id });
    await expect(
      getWorkspaceDetail({ kind: "agency", ctx: agency("agencyOne") }, other.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      getWorkspaceDetail({ kind: "platform", ctx: platform }, other.id),
    ).resolves.toMatchObject({ id: other.id });
    await expect(
      getWorkspaceDetail({ kind: "platform", ctx: platform }, "../agencies/x"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("invites staff once, lists them as pending, and refuses admins inviting", async () => {
    const owner = agency("agencyOne");
    await expect(inviteStaff(owner, "New.Admin@Agency.test")).resolves.toMatchObject({
      email: "new.admin@agency.test",
    });
    await expect(inviteStaff(owner, "new.admin@agency.test")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const { pending } = await listStaff(owner);
    expect(pending.map((p) => p.email)).toEqual(["new.admin@agency.test"]);
    await expect(
      inviteStaff(agency("agencyOne", "agency_admin"), "x@a.test"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses to invite someone who is already staff", async () => {
    await createUser(getAdminAuth(), "u_existing");
    await getDb().doc(`agencies/${AGENCIES.agencyOne.id}/staff/u_existing`).set({
      uid: "u_existing",
      email: "existing@agency.test",
      displayName: "E",
      role: "agency_admin",
      status: "active",
    });
    const { staff } = await listStaff(agency("agencyOne"));
    expect(staff.map((s) => s.email)).toContain("existing@agency.test");
    await expect(inviteStaff(agency("agencyOne"), "existing@agency.test")).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("builds the usage report for its own workspaces as formula-safe CSV", async () => {
    const rows = await agencyUsageReport(agency("agencyOne"));
    expect(rows.length).toBe((await listAgencyWorkspaces(agency("agencyOne"))).length);
    const csv = usageReportCsv([{ ...rows[0]!, name: "=HYPERLINK(1)" }]);
    expect(csv).toContain("'=HYPERLINK(1)");
  });
});
