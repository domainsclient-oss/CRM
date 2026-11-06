import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import type { WorkspaceRole } from "@crm/shared/permissions";
import { contactInput } from "@crm/shared/records/schemas";
import { signInWithPassword } from "@crm/testing/auth-emulator";
import { WORKSPACES, buildAgency, buildWorkspace, uidFor } from "@crm/testing/fixtures";
import {
  TEST_PASSWORD,
  addMember,
  createUser,
  resetEmulators,
  seedTenancy,
} from "@crm/testing/seed";
import { createActionWrappers, type RequestInfo } from "../actions/wrappers";
import { clearTenantCaches, type TenantContext } from "../contexts/tenant-context";
import { getAdminAuth, getDb } from "../firebase-admin";
import { logger } from "../logger";
import type { AgencyDoc, TenantDoc } from "../model";
import { MemoryRateLimiter, setRateLimiter } from "../rate-limit";
import { saveContact } from "../records/contacts";
import { restoreRecord, softDeleteRecord } from "../records/trash";
import { inviteMember } from "../services/members";
import { createSessionCookie } from "../session";
import { resolveEffectiveConfig } from "./entitlements";
import { getUsageSummary, reconcileUsage, setWorkspacePlan, usageBanner } from "./usage";

// Plans, limits, read-only mode, usage (TC-PLAN-001/002/003, TC-BRAND-004).

const ACME = WORKSPACES.acme;
const tenantPath = `tenants/${ACME.id}`;

async function ctx(role: WorkspaceRole = "owner"): Promise<TenantContext> {
  clearTenantCaches();
  const tenant = (await getDb().doc(tenantPath).get()).data() as TenantDoc;
  return {
    tenantId: ACME.id,
    agencyId: ACME.agencyId,
    uid: uidFor("acme", role),
    role,
    session: { uid: "x", authTime: Math.floor(Date.now() / 1000) } as never,
    tenant,
    requestId: "req_test",
    log: logger,
  };
}

const platform = (role: "superadmin" | "support") =>
  ({ uid: "u_ops", role, session: {} as never, requestId: "req", log: logger }) as never;

beforeEach(async () => {
  await resetEmulators();
  await seedTenancy(getDb());
  await addMember(getDb(), "acme", uidFor("acme", "owner"), "owner");
  await getDb().doc(`${tenantPath}/usage/current`).set({ seats: 1, records: 0 });
  setRateLimiter(new MemoryRateLimiter());
  clearTenantCaches();
});

describe("resolveEffectiveConfig", () => {
  const agency = buildAgency("agencyOne") as unknown as AgencyDoc;
  it("applies plan, overrides, flags, and powered-by rules", () => {
    const growth = resolveEffectiveConfig(
      {
        planId: "growth",
        billingState: "active",
        entitlementOverrides: { seats: 40 },
        featureFlags: { bulkActions: true, bogus: true },
      },
      { ...agency, entitlements: { ...agency.entitlements, removePoweredBy: true } },
    );
    expect(growth).toMatchObject({
      planId: "growth",
      limits: { seats: 40, records: 100_000 },
      flags: { bulkActions: true, dashboardV2: false },
      showPoweredBy: false,
      readOnly: false,
    });
    // Powered-by stays unless BOTH plan and agency allow removing it (FR-BRAND-004).
    expect(
      resolveEffectiveConfig({ planId: "growth", billingState: "active" }, agency).showPoweredBy,
    ).toBe(true);
    expect(
      resolveEffectiveConfig({ planId: "unknown", billingState: "active" }, agency).planId,
    ).toBe("trial");
    expect(
      resolveEffectiveConfig(
        {
          planId: "trial",
          billingState: "trialing",
          trialEndsAt: Timestamp.fromMillis(Date.now() - 1000),
        },
        agency,
      ).readOnly,
    ).toBe(true);
  });
});

describe("limits (TC-PLAN-001)", () => {
  it("blocks record creation and restore beyond the record limit", async () => {
    await getDb()
      .doc(tenantPath)
      .update({ entitlementOverrides: { records: 2 } });
    await saveContact(await ctx(), null, contactInput.parse({ firstName: "A" }));
    const { id } = await saveContact(await ctx(), null, contactInput.parse({ firstName: "B" }));
    await expect(
      saveContact(await ctx(), null, contactInput.parse({ firstName: "C" })),
    ).rejects.toMatchObject({
      code: "PLAN_LIMIT_EXCEEDED",
    });
    await softDeleteRecord(await ctx(), "contact", id);
    await saveContact(await ctx(), null, contactInput.parse({ firstName: "C" }));
    await expect(restoreRecord(await ctx(), "contact", id)).rejects.toMatchObject({
      code: "PLAN_LIMIT_EXCEEDED",
    });
  });

  it("counts outstanding invitations toward the seat limit", async () => {
    await getDb()
      .doc(tenantPath)
      .update({ entitlementOverrides: { seats: 2 } });
    await inviteMember(await ctx(), { email: "one@acme.test", role: "member" });
    await expect(
      inviteMember(await ctx(), { email: "two@acme.test", role: "member" }),
    ).rejects.toMatchObject({
      code: "PLAN_LIMIT_EXCEEDED",
    });
  });
});

describe("read-only mode (FR-PLAN-001, FR-BILL-002 AC3)", () => {
  it("blocks mutations through the action wrapper but allows reads", async () => {
    await createUser(getAdminAuth(), "u_ro");
    await addMember(getDb(), "acme", "u_ro", "owner");
    const idToken = await signInWithPassword("u_ro@example.test", TEST_PASSWORD);
    const { cookie } = await createSessionCookie(
      idToken,
      { kind: "workspace", host: ACME.canonicalHost },
      false,
    );
    await getDb().doc(tenantPath).update({ billingState: "read_only" });
    clearTenantCaches();
    const req: RequestInfo = {
      host: ACME.canonicalHost,
      origin: `http://${ACME.canonicalHost}`,
      secure: false,
      ip: "203.0.113.1",
      userAgent: "vitest",
      cookie: (name) => (name === "session" ? cookie : undefined),
    };
    const wrap = createActionWrappers(async () => req);
    const write = wrap.tenant({
      name: "test.readonly.write",
      permission: "record.create",
      schema: z.object({}),
      handler: async () => "wrote",
    });
    const read = wrap.tenant({
      name: "test.readonly.read",
      permission: "record.read",
      schema: z.object({}),
      handler: async () => "read",
    });
    expect(await write({})).toMatchObject({ ok: false, error: { code: "BILLING_READ_ONLY" } });
    expect(await read({})).toEqual({ ok: true, data: "read" });
  });
});

describe("usage (TC-PLAN-002) and plan management", () => {
  it("summarizes usage, warns at 80 %, and reconciles drift", async () => {
    await getDb()
      .doc(tenantPath)
      .update({ entitlementOverrides: { records: 5 } });
    for (const name of ["A", "B", "C", "D"]) {
      await saveContact(await ctx(), null, contactInput.parse({ firstName: name }));
    }
    expect(await getUsageSummary(await ctx())).toMatchObject({
      records: { used: 4, limit: 5 },
      level: "warning",
    });
    expect(await usageBanner(await ctx("member"))).toBeNull();
    await expect(getUsageSummary(await ctx("member"))).rejects.toMatchObject({ code: "FORBIDDEN" });

    await getDb().doc(`${tenantPath}/usage/current`).update({ records: 99, seats: 7 });
    expect(await reconcileUsage(ACME.id)).toEqual({ seats: -6, records: -95 });
    expect((await getUsageSummary(await ctx())).records.used).toBe(4);
  });

  it("only platform staff with plan.manage change plans; audited", async () => {
    await expect(
      setWorkspacePlan(platform("support"), ACME.id, {
        planId: "enterprise",
        overrides: {},
        flags: {},
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setWorkspacePlan(platform("superadmin"), ACME.id, {
      planId: "starter",
      overrides: { seats: 9, records: null },
      flags: { globalSearch: true },
    });
    const tenant = (await getDb().doc(tenantPath).get()).data()!;
    expect(tenant).toMatchObject({
      planId: "starter",
      entitlementOverrides: { seats: 9 },
      featureFlags: { globalSearch: true },
    });
    const audits = await getDb()
      .collection("platformAuditLogs")
      .where("action", "==", "plan.changed")
      .get();
    expect(audits.size).toBe(1);
    expect(buildWorkspace("acme").planId).toBe("growth");
  });
});
