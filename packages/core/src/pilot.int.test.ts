import { beforeEach, describe, expect, it } from "vitest";
import { resetEmulators } from "@crm/testing/seed";
import type { PlatformContext } from "./contexts/platform-context";
import { clearTenantCaches } from "./contexts/tenant-context";
import { getDb } from "./firebase-admin";
import { logger } from "./logger";
import { provisionPilot, type PilotConfig } from "./pilot";
import { MemoryRateLimiter, setRateLimiter } from "./rate-limit";

// UAT pilot provisioning (T-10-02) through the real provisioning and domain services.

process.env.APP_BASE_DOMAIN = "app.localhost";
process.env.TEST_VERCEL_DOMAINS_MOCK = "true";

const operator: PlatformContext = {
  uid: "u_uat_operator",
  role: "superadmin",
  session: { uid: "u_uat_operator", authTime: Math.floor(Date.now() / 1000) } as never,
  requestId: "uat",
  log: logger,
};

const config: PilotConfig = {
  agency: {
    name: "Pilot Agency",
    slug: "pilot-agency",
    ownerEmail: "owner@pilot-agency.test",
    baseDomain: "crm.pilot-agency.test",
  },
  workspaces: [
    { name: "Client One", slug: "client-one", ownerEmail: "one@client.test" },
    {
      name: "Client Two",
      slug: "client-two",
      ownerEmail: "two@client.test",
      domain: { type: "agency_subdomain" },
    },
    {
      name: "Client Three",
      slug: "client-three",
      ownerEmail: "three@client.test",
      domain: { type: "custom", host: "crm.client-three.test" },
    },
  ],
};

beforeEach(async () => {
  await resetEmulators();
  setRateLimiter(new MemoryRateLimiter());
  clearTenantCaches();
});

describe("provisionPilot (T-10-02)", () => {
  it("creates the agency, three workspaces, invitations and pending domains — idempotently", async () => {
    const first = await provisionPilot(operator, config);
    expect(first.workspaces.map((w) => w.domain)).toEqual([
      null,
      "client-two.crm.pilot-agency.test",
      "crm.client-three.test",
    ]);
    const tenants = await getDb()
      .collection("tenants")
      .where("agencyId", "==", first.agencyId)
      .get();
    expect(tenants.size).toBe(3);
    const domains = await getDb().collection("tenantDomains").get();
    const pending = domains.docs.filter((d) => d.get("status") !== "active").map((d) => d.id);
    expect(pending.sort()).toEqual(["client-two.crm.pilot-agency.test", "crm.client-three.test"]);
    const invites = await getDb().collectionGroup("invitations").get();
    expect(invites.size).toBe(4); // agency owner + 3 workspace owners

    const again = await provisionPilot(operator, config);
    expect(again).toEqual(first);
    expect((await getDb().collection("tenants").get()).size).toBe(3);
    expect((await getDb().collection("tenantDomains").get()).size).toBe(domains.size);
  });

  it("rejects invalid configs before touching the database", async () => {
    await expect(
      provisionPilot(operator, { ...config, workspaces: [] } as PilotConfig),
    ).rejects.toThrow();
    await expect(
      provisionPilot(operator, {
        agency: { ...config.agency, baseDomain: null },
        workspaces: [{ ...config.workspaces[1]! }],
      }),
    ).rejects.toThrow(/agency_subdomain needs agency.baseDomain/);
  });
});
