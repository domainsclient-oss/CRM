import { beforeEach, describe, expect, it } from "vitest";
import { signInWithGoogle, signInWithPassword } from "@crm/testing/auth-emulator";
import { AGENCIES, WORKSPACES } from "@crm/testing/fixtures";
import {
  TEST_PASSWORD,
  addContact,
  addMember,
  createUser,
  resetEmulators,
  seedTenancy,
} from "@crm/testing/seed";
import { getAdminAuth, getDb } from "../firebase-admin";
import { getById, scopedQuery } from "../repositories/base";
import { createSessionCookie, revokeAllSessions } from "../session";
import { requireAgencyContext } from "./agency-context";
import { requirePlatformContext } from "./platform-context";
import { clearTenantCaches, requireTenantContext } from "./tenant-context";

const ACME = WORKSPACES.acme.canonicalHost;
const INITECH = WORKSPACES.initech.canonicalHost;
const req = { requestId: "req_test" };
const CONSOLE = "console.localhost:3001";
const PARTNERS = "partners.localhost:3001";
const consoleReq = { ...req, host: CONSOLE };
const partnersReq = { ...req, host: PARTNERS };

async function sessionFor(uid: string, host: string = ACME): Promise<string> {
  const idToken = await signInWithPassword(`${uid}@example.test`, TEST_PASSWORD);
  return (await createSessionCookie(idToken, { kind: "workspace", host }, false)).cookie;
}

beforeEach(async () => {
  await resetEmulators();
  clearTenantCaches();
  await seedTenancy(getDb());
});

describe("requireTenantContext", () => {
  it("builds a context for an active member on the workspace host", async () => {
    await createUser(getAdminAuth(), "u_raj");
    await addMember(getDb(), "acme", "u_raj", "member");
    const ctx = await requireTenantContext({
      host: ACME,
      sessionCookie: await sessionFor("u_raj"),
      ...req,
    });
    expect(ctx).toMatchObject({ tenantId: WORKSPACES.acme.id, uid: "u_raj", role: "member" });
  });

  it("normalizes host case", async () => {
    await createUser(getAdminAuth(), "u_raj");
    await addMember(getDb(), "acme", "u_raj", "member");
    const cookie = await sessionFor("u_raj");
    await expect(
      requireTenantContext({ host: ACME.toUpperCase(), sessionCookie: cookie, ...req }),
    ).resolves.toMatchObject({ tenantId: WORKSPACES.acme.id });
  });

  it("returns NOT_FOUND for unknown, malformed, or unverified hosts", async () => {
    await getDb().doc("tenantDomains/pending.acme.test").set({
      tenantId: WORKSPACES.acme.id,
      agencyId: AGENCIES.agencyOne.id,
      type: "custom",
      status: "pending_dns",
      isCanonical: false,
    });
    for (const host of ["nope.example.test", "bad host", "pending.acme.test"]) {
      await expect(
        requireTenantContext({ host, sessionCookie: "x", ...req }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
  });

  it("rejects missing, forged, and revoked sessions", async () => {
    await createUser(getAdminAuth(), "u_raj");
    await addMember(getDb(), "acme", "u_raj", "member");
    for (const cookie of [undefined, "forged.session.cookie"]) {
      await expect(
        requireTenantContext({ host: ACME, sessionCookie: cookie, ...req }),
      ).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
    }
    const cookie = await sessionFor("u_raj");
    await new Promise((r) => setTimeout(r, 1100)); // revocation is second-granular
    await revokeAllSessions("u_raj");
    await expect(
      requireTenantContext({ host: ACME, sessionCookie: cookie, ...req }),
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("denies a member of one workspace on another workspace's host (TC-SEC-001)", async () => {
    await createUser(getAdminAuth(), "u_raj");
    await addMember(getDb(), "acme", "u_raj", "owner");
    const cookie = await sessionFor("u_raj", INITECH);
    await expect(
      requireTenantContext({ host: INITECH, sessionCookie: cookie, ...req }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("denies disabled members and malformed roles", async () => {
    await createUser(getAdminAuth(), "u_raj");
    await addMember(getDb(), "acme", "u_raj", "member", { status: "disabled" });
    const cookie = await sessionFor("u_raj");
    await expect(
      requireTenantContext({ host: ACME, sessionCookie: cookie, ...req }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await addMember(getDb(), "acme", "u_raj", "member", { role: "superuser" });
    await expect(
      requireTenantContext({ host: ACME, sessionCookie: cookie, ...req }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("blocks suspended workspaces and workspaces of suspended agencies (TC-SEC-015)", async () => {
    await createUser(getAdminAuth(), "u_raj");
    await addMember(getDb(), "acme", "u_raj", "owner");
    const cookie = await sessionFor("u_raj");

    await getDb().doc(`tenants/${WORKSPACES.acme.id}`).update({ status: "suspended" });
    clearTenantCaches();
    await expect(
      requireTenantContext({ host: ACME, sessionCookie: cookie, ...req }),
    ).rejects.toMatchObject({
      code: "TENANT_SUSPENDED",
    });

    await getDb().doc(`tenants/${WORKSPACES.acme.id}`).update({ status: "active" });
    await getDb().doc(`agencies/${AGENCIES.agencyOne.id}`).update({ status: "suspended" });
    clearTenantCaches();
    await expect(
      requireTenantContext({ host: ACME, sessionCookie: cookie, ...req }),
    ).rejects.toMatchObject({
      code: "TENANT_SUSPENDED",
    });
  });

  it("refuses to create sessions for unverified emails", async () => {
    await createUser(getAdminAuth(), "u_new", { emailVerified: false });
    const idToken = await signInWithPassword("u_new@example.test", TEST_PASSWORD);
    await expect(
      createSessionCookie(idToken, { kind: "workspace", host: ACME }, false),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("scoped repository (TC-RBAC-004, TC-SEC-001)", () => {
  beforeEach(async () => {
    for (const [uid, role] of [
      ["u_raj", "member"],
      ["u_lena", "member"],
      ["u_mgr", "manager"],
    ] as const) {
      await createUser(getAdminAuth(), uid);
      await addMember(getDb(), "acme", uid, role);
    }
    await addContact(getDb(), "acme", "c_raj", "u_raj");
    await addContact(getDb(), "acme", "c_lena", "u_lena");
    await addContact(getDb(), "initech", "c_initech", "u_other");
  });

  const ctxFor = async (uid: string) =>
    requireTenantContext({ host: ACME, sessionCookie: await sessionFor(uid), ...req });

  it("members list only their own records; managers list all", async () => {
    const raj = await ctxFor("u_raj");
    const mine = await scopedQuery(raj, "contacts").get();
    expect(mine.docs.map((d) => d.id)).toEqual(["c_raj"]);

    const mgr = await ctxFor("u_mgr");
    const all = await scopedQuery(mgr, "contacts").get();
    expect(all.docs.map((d) => d.id).sort()).toEqual(["c_lena", "c_raj"]);
  });

  it("members cannot load a colleague's record by ID", async () => {
    const raj = await ctxFor("u_raj");
    await expect(getById(raj, "contacts", "c_raj")).resolves.toMatchObject({ id: "c_raj" });
    await expect(getById(raj, "contacts", "c_lena")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("another workspace's record ID resolves to NOT_FOUND", async () => {
    const mgr = await ctxFor("u_mgr");
    await expect(getById(mgr, "contacts", "c_initech")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("unsafe IDs are rejected before touching Firestore", async () => {
    const mgr = await ctxFor("u_mgr");
    for (const id of ["../../tenants/tnt_initech/contacts/c_initech", "a/b", ""]) {
      await expect(getById(mgr, "contacts", id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });
});

describe("requirePlatformContext (FR-AUTH-008)", () => {
  it("accepts Google sign-in from an allowlisted domain with a platformAdmins record", async () => {
    const { idToken, uid } = await signInWithGoogle({ sub: "g-ops", email: "ops@example.com" });
    await getDb()
      .doc(`platformAdmins/${uid}`)
      .set({ role: "superadmin", email: "ops@example.com" });
    const { cookie } = await createSessionCookie(
      idToken,
      { kind: "console", host: CONSOLE },
      false,
    );
    await expect(
      requirePlatformContext({ sessionCookie: cookie, ...consoleReq }),
    ).resolves.toMatchObject({
      uid,
      role: "superadmin",
    });
  });

  it("rejects non-allowlisted domains even with a platformAdmins record", async () => {
    const { idToken, uid } = await signInWithGoogle({ sub: "g-evil", email: "ops@evil.test" });
    await getDb().doc(`platformAdmins/${uid}`).set({ role: "superadmin", email: "ops@evil.test" });
    const { cookie } = await createSessionCookie(
      idToken,
      { kind: "console", host: CONSOLE },
      false,
    );
    await expect(
      requirePlatformContext({ sessionCookie: cookie, ...consoleReq }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects password sign-in for platform staff", async () => {
    await createUser(getAdminAuth(), "u_ops");
    await getDb()
      .doc("platformAdmins/u_ops")
      .set({ role: "superadmin", email: "u_ops@example.test" });
    const { cookie } = await createSessionCookie(
      await signInWithPassword("u_ops@example.test", TEST_PASSWORD),
      { kind: "console", host: CONSOLE },
      false,
    );
    await expect(
      requirePlatformContext({ sessionCookie: cookie, ...consoleReq }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("requireAgencyContext (FR-AGY-003)", () => {
  async function staffSession(uid: string, agencyId: string) {
    await createUser(getAdminAuth(), uid);
    await getDb()
      .doc(`agencies/${agencyId}/staff/${uid}`)
      .set({
        uid,
        agencyId,
        email: `${uid}@example.test`,
        displayName: uid,
        role: "agency_admin",
        status: "active",
      });
    await getDb()
      .doc(`users/${uid}`)
      .set({ agencyIds: [agencyId], tenantIds: [] }, { merge: true });
    const idToken = await signInWithPassword(`${uid}@example.test`, TEST_PASSWORD);
    return (await createSessionCookie(idToken, { kind: "partners", host: PARTNERS }, false)).cookie;
  }

  it("uses the agency from the user's own staff record", async () => {
    const cookie = await staffSession("u_priya", AGENCIES.agencyOne.id);
    await expect(
      requireAgencyContext({ sessionCookie: cookie, ...partnersReq }),
    ).resolves.toMatchObject({
      agencyId: AGENCIES.agencyOne.id,
      role: "agency_admin",
    });
  });

  it("ignores a selected agency the user doesn't staff (TC-AGY-003)", async () => {
    const cookie = await staffSession("u_priya", AGENCIES.agencyOne.id);
    const ctx = await requireAgencyContext({
      sessionCookie: cookie,
      selectedAgencyId: AGENCIES.agencyTwo.id,
      ...partnersReq,
    });
    expect(ctx.agencyId).toBe(AGENCIES.agencyOne.id);
  });

  it("rejects a forged agencyIds hint without a staff record", async () => {
    const cookie = await staffSession("u_priya", AGENCIES.agencyOne.id);
    await getDb()
      .doc("users/u_priya")
      .set({ agencyIds: [AGENCIES.agencyTwo.id] }, { merge: true });
    await expect(
      requireAgencyContext({ sessionCookie: cookie, ...partnersReq }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("workspace members without staff records are denied", async () => {
    await createUser(getAdminAuth(), "u_raj");
    const idToken = await signInWithPassword("u_raj@example.test", TEST_PASSWORD);
    const { cookie } = await createSessionCookie(
      idToken,
      { kind: "partners", host: PARTNERS },
      false,
    );
    await expect(
      requireAgencyContext({ sessionCookie: cookie, ...partnersReq }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("session cookies are bound to surface + host (T-09-01 F-03, TC-TEN-007)", () => {
  async function owner() {
    await createUser(getAdminAuth(), "u_bound");
    await addMember(getDb(), "acme", "u_bound", "owner");
    await addMember(getDb(), "initech", "u_bound", "owner");
    await getDb()
      .doc("platformAdmins/u_bound")
      .set({ role: "superadmin", email: "x@example.test" });
    return signInWithPassword("u_bound@example.test", TEST_PASSWORD);
  }

  it("refuses a workspace cookie replayed on another workspace host, even for a member there", async () => {
    const { cookie } = await createSessionCookie(
      await owner(),
      { kind: "workspace", host: ACME },
      false,
    );
    await expect(
      requireTenantContext({ host: ACME, sessionCookie: cookie, ...req }),
    ).resolves.toMatchObject({ uid: "u_bound" });
    await expect(
      requireTenantContext({ host: INITECH, sessionCookie: cookie, ...req }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("refuses a workspace cookie replayed on the consoles", async () => {
    const { cookie } = await createSessionCookie(
      await owner(),
      { kind: "workspace", host: ACME },
      false,
    );
    await expect(
      requirePlatformContext({ sessionCookie: cookie, ...consoleReq }),
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(
      requireAgencyContext({ sessionCookie: cookie, ...partnersReq }),
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("refuses unbound Firebase cookies and tampered bindings", async () => {
    const { cookie } = await createSessionCookie(
      await owner(),
      { kind: "workspace", host: ACME },
      false,
    );
    const raw = cookie.slice(0, cookie.lastIndexOf("~"));
    for (const forged of [raw, `${raw}~`, `${raw}~${"A".repeat(43)}`, `x${cookie}`]) {
      await expect(
        requireTenantContext({ host: ACME, sessionCookie: forged, ...req }),
      ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    }
  });
});
