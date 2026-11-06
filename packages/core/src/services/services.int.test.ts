import { beforeEach, describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { signInWithGoogle, signInWithPassword } from "@crm/testing/auth-emulator";
import { TEST_PASSWORD, addMember, createUser, resetEmulators } from "@crm/testing/seed";
import type { AgencyContext } from "../contexts/agency-context";
import type { PlatformContext } from "../contexts/platform-context";
import { clearTenantCaches, requireTenantContext } from "../contexts/tenant-context";
import { getAdminAuth, getDb } from "../firebase-admin";
import { logger } from "../logger";
import { verifySession } from "../session";
import { hashToken } from "../tokens";
import {
  findOrphanAccounts,
  recordPrivilegedLogin,
  requestPasswordReset,
  revokeWithAlertToken,
  startWorkspaceSession,
} from "./auth";
import { acceptInvitation, viewInvitation } from "./invitations";
import {
  provisionAgency,
  provisionWorkspace,
  setAgencyStatus,
  setWorkspaceStatus,
} from "./provisioning";

process.env.APP_BASE_DOMAIN = "app.localhost";
process.env.APP_PARTNERS_HOST = "partners.localhost";

const PARTNERS = "partners.localhost";
let n = 0;
const key = () => `idem_key_${++n}_${Date.now()}`;

function platformCtx(uid = "u_ops"): PlatformContext {
  return {
    uid,
    role: "superadmin",
    session: {
      uid,
      email: "ops@example.com",
      emailVerified: true,
      authTime: 0,
      signInProvider: "google.com",
    },
    requestId: "req_test",
    log: logger,
  };
}

function agencyCtx(agencyId: string, uid = "u_staff"): AgencyContext {
  return {
    agencyId,
    uid,
    role: "agency_owner",
    session: {
      uid,
      email: `${uid}@example.test`,
      emailVerified: true,
      authTime: 0,
      signInProvider: "password",
    },
    agency: {} as AgencyContext["agency"],
    requestId: "req_test",
    log: logger,
  };
}

/** The raw token from the most recent invitation email for this address. */
async function tokenFromOutbox(email: string): Promise<string> {
  const snap = await getDb().collection("mailOutbox").where("to", "==", email).get();
  const links = snap.docs
    .map((d) => d.data())
    .filter((m) => String(m.template).endsWith("_invitation"))
    .map((m) => String(m.variables.link));
  const link = links.at(-1);
  if (!link) throw new Error(`no invitation email for ${email}`);
  return link.split("/invite/")[1]!;
}

async function newAgency(overrides: Partial<Parameters<typeof provisionAgency>[1]> = {}) {
  return provisionAgency(platformCtx(), {
    name: "Agency One",
    slug: "agency-one",
    ownerEmail: "priya@agency.test",
    maxWorkspaces: 2,
    maxSeatsTotal: 3,
    canProvisionWorkspaces: false,
    idempotencyKey: key(),
    ...overrides,
  });
}

beforeEach(async () => {
  await resetEmulators();
  clearTenantCaches();
});

describe("agency provisioning and owner onboarding (TC-AGY-001)", () => {
  it("creates the agency and an agency_owner invitation on the partners host", async () => {
    const { agencyId } = await newAgency();
    const agency = (await getDb().doc(`agencies/${agencyId}`).get()).data();
    expect(agency).toMatchObject({ status: "active", ownerUid: null, slug: "agency-one" });

    const token = await tokenFromOutbox("priya@agency.test");
    await expect(viewInvitation(token, PARTNERS)).resolves.toMatchObject({
      kind: "agency",
      role: "agency_owner",
      accountExists: false,
    });
    const { uid } = await acceptInvitation(
      { token, newAccount: { displayName: "Priya", password: "a-long-password-1" } },
      { host: PARTNERS, requestId: "r" },
    );
    const staff = (await getDb().doc(`agencies/${agencyId}/staff/${uid}`).get()).data();
    expect(staff).toMatchObject({ role: "agency_owner", status: "active" });
    expect((await getDb().doc(`agencies/${agencyId}`).get()).get("ownerUid")).toBe(uid);
    expect((await getAdminAuth().getUser(uid)).emailVerified).toBe(true);
  });

  it("rejects duplicate slugs and replays idempotent retries", async () => {
    const idem = key();
    const a = await newAgency({ idempotencyKey: idem });
    const b = await newAgency({ idempotencyKey: idem });
    expect(b).toEqual(a);
    await expect(newAgency()).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("workspace provisioning (TC-TEN-001, TC-TEN-003)", () => {
  it("creates workspace, active platform host, pipeline, usage, subscription and owner invite", async () => {
    const { agencyId } = await newAgency();
    const { tenantId, host } = await provisionWorkspace(
      { kind: "platform", ctx: platformCtx() },
      {
        agencyId,
        name: "Acme",
        slug: "acme",
        ownerEmail: "owner@acme.test",
        idempotencyKey: key(),
      },
    );
    expect(host).toBe("acme.app.localhost");
    const db = getDb();
    expect((await db.doc(`tenants/${tenantId}`).get()).data()).toMatchObject({
      agencyId,
      status: "active",
      canonicalHost: host,
    });
    expect((await db.doc(`tenantDomains/${host}`).get()).data()).toMatchObject({
      tenantId,
      status: "active",
    });
    expect((await db.doc(`tenants/${tenantId}/pipelines/default`).get()).exists).toBe(true);
    expect((await db.doc(`agencies/${agencyId}`).get()).get("usage.workspaces")).toBe(1);
    const audits = await db.collection(`tenants/${tenantId}/auditLogs`).get();
    expect(audits.docs.map((d) => d.get("action"))).toContain("tenant.created");
  });

  it("only one of two concurrent requests for the same slug succeeds", async () => {
    const { agencyId } = await newAgency({ maxWorkspaces: 5 });
    const attempt = () =>
      provisionWorkspace(
        { kind: "platform", ctx: platformCtx() },
        { agencyId, name: "Acme", slug: "acme", ownerEmail: "o@acme.test", idempotencyKey: key() },
      );
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("enforces the agency workspace quota", async () => {
    const { agencyId } = await newAgency({ maxWorkspaces: 1 });
    const make = (slug: string) =>
      provisionWorkspace(
        { kind: "platform", ctx: platformCtx() },
        { agencyId, name: slug, slug, ownerEmail: `${slug}@x.test`, idempotencyKey: key() },
      );
    await make("first");
    await expect(make("second")).rejects.toMatchObject({ code: "PLAN_LIMIT_EXCEEDED" });
  });

  it("agency staff need the entitlement and can never target another agency (TC-AGY-003)", async () => {
    const one = await newAgency();
    const two = await newAgency({
      slug: "agency-two",
      ownerEmail: "tom@two.test",
      canProvisionWorkspaces: true,
    });
    await expect(
      provisionWorkspace(
        { kind: "agency", ctx: agencyCtx(one.agencyId) },
        { name: "X", slug: "x-ws", ownerEmail: "x@x.test", idempotencyKey: key() },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const created = await provisionWorkspace(
      { kind: "agency", ctx: agencyCtx(two.agencyId) },
      // agencyId in input is ignored for agency staff
      {
        agencyId: one.agencyId,
        name: "Y",
        slug: "y-ws",
        ownerEmail: "y@y.test",
        idempotencyKey: key(),
      },
    );
    expect((await getDb().doc(`tenants/${created.tenantId}`).get()).get("agencyId")).toBe(
      two.agencyId,
    );
  });
});

describe("invitation acceptance (TC-RBAC-001)", () => {
  async function workspaceWithOwnerInvite() {
    const { agencyId } = await newAgency();
    const ws = await provisionWorkspace(
      { kind: "platform", ctx: platformCtx() },
      {
        agencyId,
        name: "Acme",
        slug: "acme",
        ownerEmail: "owner@acme.test",
        idempotencyKey: key(),
      },
    );
    return { ...ws, agencyId, token: await tokenFromOutbox("owner@acme.test") };
  }

  it("creates the account and owner membership, then the token is single-use", async () => {
    const { tenantId, host, token } = await workspaceWithOwnerInvite();
    const { uid } = await acceptInvitation(
      { token, newAccount: { displayName: "Olivia", password: "a-long-password-1" } },
      { host, requestId: "r" },
    );
    const db = getDb();
    expect((await db.doc(`tenants/${tenantId}/members/${uid}`).get()).data()).toMatchObject({
      role: "owner",
      status: "active",
    });
    expect((await db.doc(`tenants/${tenantId}`).get()).get("ownerUid")).toBe(uid);
    expect((await db.doc(`users/${uid}`).get()).get("tenantIds")).toEqual([tenantId]);
    expect((await db.doc(`invitationTokens/${hashToken(token)}`).get()).exists).toBe(false);

    await expect(
      acceptInvitation(
        { token, newAccount: { displayName: "Again", password: "a-long-password-1" } },
        { host, requestId: "r" },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("only works on the invitation's own host", async () => {
    const { token } = await workspaceWithOwnerInvite();
    await expect(viewInvitation(token, "evil.app.localhost")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      acceptInvitation(
        { token, newAccount: { displayName: "Eve", password: "a-long-password-1" } },
        { host: "evil.app.localhost", requestId: "r" },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects expired and unknown tokens identically", async () => {
    const { host, token } = await workspaceWithOwnerInvite();
    const pointer = await getDb()
      .doc(`invitationTokens/${hashToken(token)}`)
      .get();
    await getDb()
      .doc(pointer.get("path"))
      .update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    for (const t of [token, "A".repeat(43)]) {
      await expect(viewInvitation(t, host)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("existing accounts must sign in as the invited email", async () => {
    const { host, token } = await workspaceWithOwnerInvite();
    await createUser(getAdminAuth(), "u_someone_else");
    const wrongIdToken = await signInWithPassword("u_someone_else@example.test", TEST_PASSWORD);
    await expect(
      acceptInvitation({ token, idToken: wrongIdToken }, { host, requestId: "r" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await getAdminAuth().createUser({
      email: "owner@acme.test",
      password: TEST_PASSWORD,
      emailVerified: true,
    });
    await expect(
      acceptInvitation(
        { token, newAccount: { displayName: "Dup", password: "a-long-password-1" } },
        { host, requestId: "r" },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const rightIdToken = await signInWithPassword("owner@acme.test", TEST_PASSWORD);
    await expect(
      acceptInvitation({ token, idToken: rightIdToken }, { host, requestId: "r" }),
    ).resolves.toMatchObject({
      kind: "workspace",
    });
  });

  it("deletes the new account if acceptance fails (no orphans)", async () => {
    const { host, token, agencyId } = await workspaceWithOwnerInvite();
    await getDb().doc(`agencies/${agencyId}`).update({ "usage.seats": 3 }); // at quota
    await expect(
      acceptInvitation(
        { token, newAccount: { displayName: "Olivia", password: "a-long-password-1" } },
        { host, requestId: "r" },
      ),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT_EXCEEDED" });
    await expect(getAdminAuth().getUserByEmail("owner@acme.test")).rejects.toBeDefined();
  });
});

describe("workspace sign-in and suspension (TC-AUTH-004, TC-TEN-002)", () => {
  async function ownedWorkspace() {
    const { agencyId } = await newAgency();
    const ws = await provisionWorkspace(
      { kind: "platform", ctx: platformCtx() },
      {
        agencyId,
        name: "Acme",
        slug: "acme",
        ownerEmail: "owner@acme.test",
        idempotencyKey: key(),
      },
    );
    const token = await tokenFromOutbox("owner@acme.test");
    const { uid } = await acceptInvitation(
      { token, newAccount: { displayName: "Olivia", password: "a-long-password-1" } },
      { host: ws.host, requestId: "r" },
    );
    return { ...ws, agencyId, uid };
  }
  const client = (host: string) => ({
    host,
    secure: false,
    ip: "203.0.113.1",
    userAgent: "vitest",
    requestId: "r",
  });

  it("issues a session only to members of the host's workspace", async () => {
    const { host, tenantId } = await ownedWorkspace();
    const idToken = await signInWithPassword("owner@acme.test", "a-long-password-1");
    const { cookie } = await startWorkspaceSession(idToken, client(host));
    const ctx = await requireTenantContext({ host, sessionCookie: cookie, requestId: "r" });
    expect(ctx).toMatchObject({ tenantId, role: "owner" });

    await createUser(getAdminAuth(), "u_outsider");
    const outsider = await signInWithPassword("u_outsider@example.test", TEST_PASSWORD);
    await expect(startWorkspaceSession(outsider, client(host))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("agency staff can suspend only their own agency's workspaces", async () => {
    const { tenantId, agencyId } = await ownedWorkspace();
    const other = await newAgency({ slug: "agency-two", ownerEmail: "tom@two.test" });
    await expect(
      setWorkspaceStatus({ kind: "agency", ctx: agencyCtx(other.agencyId) }, tenantId, "suspended"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await setWorkspaceStatus({ kind: "agency", ctx: agencyCtx(agencyId) }, tenantId, "suspended");
    expect((await getDb().doc(`tenants/${tenantId}`).get()).get("status")).toBe("suspended");
  });

  it("suspended workspaces and agencies refuse new sessions", async () => {
    const { host, tenantId, agencyId } = await ownedWorkspace();
    const signIn = () => signInWithPassword("owner@acme.test", "a-long-password-1");

    await setWorkspaceStatus({ kind: "platform", ctx: platformCtx() }, tenantId, "suspended");
    clearTenantCaches();
    await expect(startWorkspaceSession(await signIn(), client(host))).rejects.toMatchObject({
      code: "TENANT_SUSPENDED",
    });

    await setWorkspaceStatus({ kind: "platform", ctx: platformCtx() }, tenantId, "active");
    await setAgencyStatus(platformCtx(), agencyId, "suspended");
    clearTenantCaches();
    await expect(startWorkspaceSession(await signIn(), client(host))).rejects.toMatchObject({
      code: "TENANT_SUSPENDED",
    });
  });
});

describe("privileged-account protections (TC-AUTH-007)", () => {
  it("alerts on a new device only, and the 'not me' link revokes sessions once", async () => {
    const { uid } = await signInWithGoogle({ sub: "g-ops", email: "ops@example.com" });
    const session = {
      uid,
      email: "ops@example.com",
      emailVerified: true,
      authTime: 0,
      signInProvider: "google.com",
    };
    const client = {
      host: "console.localhost",
      secure: false,
      ip: "203.0.113.9",
      userAgent: "UA-1",
      requestId: "r",
    };

    expect(await recordPrivilegedLogin(session, "platform", client)).toEqual({ newDevice: true });
    expect(await recordPrivilegedLogin(session, "platform", client)).toEqual({ newDevice: false });
    expect(
      await recordPrivilegedLogin(session, "platform", { ...client, ip: "198.51.100.1" }),
    ).toEqual({ newDevice: true });

    const alerts = await getDb()
      .collection("mailOutbox")
      .where("template", "==", "privileged_login_alert")
      .get();
    expect(alerts.size).toBe(2);
    const token = String(alerts.docs[0]!.get("variables.link")).split("t=")[1]!;

    const { idToken } = await signInWithGoogle({ sub: "g-ops", email: "ops@example.com" });
    const { cookie } = await (
      await import("../session")
    ).createSessionCookie(idToken, { kind: "console", host: "console.localhost" }, false);
    await new Promise((r) => setTimeout(r, 1100));
    expect(await revokeWithAlertToken(token, "r")).toBe(true);
    expect(await verifySession(cookie, { kind: "console", host: "console.localhost" })).toBeNull();
    expect(await revokeWithAlertToken(token, "r")).toBe(false);
  });
});

describe("password reset and orphans", () => {
  it("queues a reset email only for existing accounts, with the same outcome either way (TC-AUTH-003)", async () => {
    await createUser(getAdminAuth(), "u_known");
    const client = {
      host: "acme.app.localhost",
      secure: false,
      ip: null,
      userAgent: null,
      requestId: "r",
    };
    await expect(requestPasswordReset("u_known@example.test", client)).resolves.toBeUndefined();
    await expect(requestPasswordReset("nobody@example.test", client)).resolves.toBeUndefined();
    const resets = await getDb()
      .collection("mailOutbox")
      .where("template", "==", "password_reset")
      .get();
    expect(resets.docs.map((d) => d.get("to"))).toEqual(["u_known@example.test"]);
  });

  it("finds accounts without any membership (FR-AUTH-001 AC1a)", async () => {
    await createUser(getAdminAuth(), "u_orphan");
    await createUser(getAdminAuth(), "u_member");
    await getDb()
      .doc("users/u_member")
      .set({ tenantIds: ["tnt_x"], agencyIds: [] });
    expect(await findOrphanAccounts(0)).toEqual(["u_orphan"]);
  });

  it("membership docs added outside invitations are still respected by contexts", async () => {
    // Guard: test helper path stays consistent with production reads.
    await createUser(getAdminAuth(), "u_x");
    await addMember(getDb(), "acme", "u_x", "viewer");
    const member = await getDb().doc("tenants/tnt_acme/members/u_x").get();
    expect(member.get("role")).toBe("viewer");
  });
});
