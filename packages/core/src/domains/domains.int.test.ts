import { beforeEach, describe, expect, it } from "vitest";
import { AGENCIES, WORKSPACES, buildAgency } from "@crm/testing/fixtures";
import { resetEmulators, seedTenancy } from "@crm/testing/seed";
import type { AgencyContext } from "../contexts/agency-context";
import {
  canonicalRedirectHost,
  clearTenantCaches,
  resolveWorkspaceByHost,
} from "../contexts/tenant-context";
import { getDb } from "../firebase-admin";
import { logger } from "../logger";
import type { AgencyDoc } from "../model";
import { MockAuthDomainSync, MockDomainProvider, setDomainProviders } from "./providers";
import {
  addAgencySubdomain,
  addDomain,
  checkDomain,
  listDomains,
  removeDomain,
  runDomainChecks,
  setAgencyBaseDomain,
  setCanonicalDomain,
} from "./service";

process.env.APP_BASE_DOMAIN = "app.localhost";

// Custom + agency domains (TC-TEN-008, TC-TEN-009) with the deterministic provider mocks.

const ACME = WORKSPACES.acme;
const FALLBACK = "acme.app.localhost";
let hosting: MockDomainProvider;
let auth: MockAuthDomainSync;

function agency(key: "agencyOne" | "agencyTwo", extra: Partial<AgencyDoc> = {}) {
  const ctx: AgencyContext = {
    agencyId: AGENCIES[key].id,
    uid: AGENCIES[key].ownerUid,
    role: "agency_owner",
    session: {} as never,
    agency: { ...(buildAgency(key) as unknown as AgencyDoc), ...extra },
    requestId: "req_test",
    log: logger,
  };
  return { kind: "agency" as const, ctx };
}
const platform = (role: "superadmin" | "support") => ({
  kind: "platform" as const,
  ctx: { uid: "u_ops", role, session: {} as never, requestId: "req", log: logger },
});

beforeEach(async () => {
  await resetEmulators();
  await seedTenancy(getDb());
  await getDb().doc(`tenantDomains/${FALLBACK}`).set({
    tenantId: ACME.id,
    agencyId: ACME.agencyId,
    type: "platform_subdomain",
    status: "active",
    isCanonical: false,
  });
  hosting = new MockDomainProvider();
  auth = new MockAuthDomainSync();
  setDomainProviders({ domains: hosting, auth });
  clearTenantCaches();
});

describe("adding and verifying (FR-TEN-005)", () => {
  it("shows DNS records, activates after verification, and syncs authorized domains", async () => {
    const added = await addDomain(agency("agencyOne"), ACME.id, "https://CRM.NewCo.test/");
    expect(added).toMatchObject({
      host: "crm.newco.test",
      status: "verifying",
      isCanonical: false,
    });
    expect(added.records).toEqual(
      expect.arrayContaining([
        { type: "CNAME", name: "crm", value: "cname.vercel-dns.com" },
        expect.objectContaining({ type: "TXT" }),
      ]),
    );
    expect(await resolveWorkspaceByHost("crm.newco.test")).toBeNull(); // not routable yet

    const checked = await checkDomain(agency("agencyOne"), ACME.id, "crm.newco.test");
    expect(checked.status).toBe("active");
    expect(auth.domains.has("crm.newco.test")).toBe(true);
    clearTenantCaches();
    expect(await resolveWorkspaceByHost("crm.newco.test")).toMatchObject({ tenantId: ACME.id });
  });

  it("enforces one workspace per host and rejects platform hosts", async () => {
    await addDomain(platform("superadmin"), ACME.id, "crm.shared.test");
    await expect(
      addDomain(platform("superadmin"), WORKSPACES.globex.id, "crm.shared.test"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    for (const bad of [
      "evil.app.localhost",
      "console.localhost:3001",
      "not a host",
      "1.2.3.4",
      "localhost",
    ]) {
      await expect(addDomain(platform("superadmin"), ACME.id, bad)).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
  });

  it("other agencies and read-only platform staff can't manage the domain (TC-AGY-003)", async () => {
    await expect(addDomain(agency("agencyTwo"), ACME.id, "crm.x.test")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(addDomain(platform("support"), ACME.id, "crm.x.test")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(listDomains(agency("agencyTwo"), ACME.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("the scheduled check activates verified hosts and flags failures", async () => {
    await addDomain(platform("superadmin"), ACME.id, "crm.ok.test");
    await addDomain(platform("superadmin"), ACME.id, "crm.pending.test");
    await addDomain(platform("superadmin"), ACME.id, "crm.fail.test");
    expect(await runDomainChecks()).toBe(2); // the failing host errored on add
    const byHost = Object.fromEntries(
      (await listDomains(platform("superadmin"), ACME.id)).map((d) => [d.host, d.status]),
    );
    expect(byHost).toMatchObject({
      "crm.ok.test": "active",
      "crm.pending.test": "verifying",
      "crm.fail.test": "error",
    });
  });
});

describe("canonical switch and removal (05 §5.1 steps 5–6)", () => {
  it("redirects the fallback host to the canonical host and reverts on removal", async () => {
    // Fixture: crm.acme.test is canonical. Make the fallback canonical first.
    await setCanonicalDomain(platform("superadmin"), ACME.id, FALLBACK);
    expect(await canonicalRedirectHost(FALLBACK)).toBeNull();

    await addDomain(agency("agencyOne"), ACME.id, "crm.brand.test");
    await expect(
      setCanonicalDomain(agency("agencyOne"), ACME.id, "crm.pending-x.test"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await checkDomain(agency("agencyOne"), ACME.id, "crm.brand.test");
    await setCanonicalDomain(agency("agencyOne"), ACME.id, "crm.brand.test");
    expect((await getDb().doc(`tenants/${ACME.id}`).get()).get("canonicalHost")).toBe(
      "crm.brand.test",
    );
    expect(await canonicalRedirectHost(FALLBACK)).toBe("crm.brand.test");
    expect(await canonicalRedirectHost("crm.brand.test")).toBeNull();

    await removeDomain(agency("agencyOne"), ACME.id, "crm.brand.test");
    expect(hosting.removed).toContain("crm.brand.test");
    expect(auth.domains.has("crm.brand.test")).toBe(false);
    expect((await getDb().doc(`tenants/${ACME.id}`).get()).get("canonicalHost")).toBe(FALLBACK);
    await expect(removeDomain(agency("agencyOne"), ACME.id, FALLBACK)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("agency domains (FR-TEN-009)", () => {
  it("adds {slug}.{base} for a workspace once the agency has a base domain", async () => {
    await expect(addAgencySubdomain(agency("agencyOne"), ACME.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const { baseDomain } = await setAgencyBaseDomain(
      agency("agencyOne").ctx,
      "crm.agency-one.test",
    );
    const view = await addAgencySubdomain(agency("agencyOne", { baseDomain }), ACME.id);
    expect(view).toMatchObject({ host: "acme.crm.agency-one.test", type: "agency_subdomain" });
  });
});
