import { beforeEach, describe, expect, it } from "vitest";
import { signInWithPassword } from "@crm/testing/auth-emulator";
import { WORKSPACES } from "@crm/testing/fixtures";
import {
  TEST_PASSWORD,
  addContact,
  addMember,
  createUser,
  resetEmulators,
  seedTenancy,
} from "@crm/testing/seed";
import type { WorkspaceRole } from "@crm/shared/permissions";
import {
  clearTenantCaches,
  requireTenantContext,
  type TenantContext,
} from "../contexts/tenant-context";
import { getAdminAuth, getDb } from "../firebase-admin";
import type { MemberDoc } from "../model";
import { MemoryRateLimiter, setRateLimiter } from "../rate-limit";
import { createSessionCookie, verifySession } from "../session";
import {
  changeRole,
  forceSignOut,
  inviteMember,
  listTeam,
  removeMember,
  resendInvitation,
  revokeInvitation,
  transferOwnership,
} from "./members";

const HOST = WORKSPACES.acme.canonicalHost;
const TENANT = WORKSPACES.acme.id;

async function person(uid: string, role: WorkspaceRole) {
  await createUser(getAdminAuth(), uid);
  await addMember(getDb(), "acme", uid, role);
  await getDb()
    .doc(`users/${uid}`)
    .set({ tenantIds: [TENANT], agencyIds: [] }, { merge: true });
}

async function ctxFor(uid: string, opts: { staleAuth?: boolean } = {}): Promise<TenantContext> {
  const idToken = await signInWithPassword(`${uid}@example.test`, TEST_PASSWORD);
  const { cookie } = await createSessionCookie(idToken, { kind: "workspace", host: HOST }, false);
  const ctx = await requireTenantContext({ host: HOST, sessionCookie: cookie, requestId: "r" });
  return opts.staleAuth
    ? { ...ctx, session: { ...ctx.session, authTime: ctx.session.authTime - 3600 } }
    : ctx;
}

const member = async (uid: string) =>
  (await getDb().doc(`tenants/${TENANT}/members/${uid}`).get()).data() as MemberDoc | undefined;

beforeEach(async () => {
  await resetEmulators();
  clearTenantCaches();
  setRateLimiter(new MemoryRateLimiter());
  await seedTenancy(getDb());
  await getDb().doc(`tenants/${TENANT}`).update({ ownerUid: "u_owner" });
  await person("u_owner", "owner");
  await person("u_admin", "admin");
  await person("u_admin2", "admin");
  await person("u_mgr", "manager");
  await person("u_raj", "member");
  await person("u_view", "viewer");
});

describe("invitations from the workspace (TC-RBAC-001)", () => {
  it("owner invites; duplicates and existing members are refused", async () => {
    const owner = await ctxFor("u_owner");
    await inviteMember(owner, { email: "New@Acme.test", role: "member" });
    await expect(
      inviteMember(owner, { email: "new@acme.test", role: "viewer" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      inviteMember(owner, { email: "u_raj@example.test", role: "viewer" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const team = await listTeam(owner);
    expect(team.invitations.map((i) => i.email)).toEqual(["new@acme.test"]);
  });

  it("admins cannot invite admins or owners; managers cannot invite at all", async () => {
    const admin = await ctxFor("u_admin");
    await expect(
      inviteMember(admin, { email: "x@acme.test", role: "admin" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      inviteMember(admin, { email: "x@acme.test", role: "owner" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      inviteMember(await ctxFor("u_mgr"), { email: "y@acme.test", role: "viewer" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("resend rotates the token (old link dies) and stops after 3; revoke kills the link", async () => {
    const owner = await ctxFor("u_owner");
    const { invitationId } = await inviteMember(owner, { email: "new@acme.test", role: "member" });
    const ref = getDb().doc(`tenants/${TENANT}/invitations/${invitationId}`);
    const firstHash = (await ref.get()).get("tokenHash");
    await resendInvitation(owner, invitationId);
    const secondHash = (await ref.get()).get("tokenHash");
    expect(secondHash).not.toBe(firstHash);
    expect((await getDb().doc(`invitationTokens/${firstHash}`).get()).exists).toBe(false);
    await resendInvitation(owner, invitationId);
    await resendInvitation(owner, invitationId);
    await expect(resendInvitation(owner, invitationId)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });

    await revokeInvitation(owner, invitationId);
    expect((await ref.get()).get("status")).toBe("revoked");
    const lastHash = (await ref.get()).get("tokenHash");
    expect((await getDb().doc(`invitationTokens/${lastHash}`).get()).exists).toBe(false);
  });

  it("members and viewers don't see pending invitations", async () => {
    await inviteMember(await ctxFor("u_owner"), { email: "new@acme.test", role: "member" });
    expect((await listTeam(await ctxFor("u_raj"))).invitations).toEqual([]);
  });
});

describe("role changes (TC-RBAC-003)", () => {
  it("owner changes roles; promoting to admin needs a recent sign-in", async () => {
    await changeRole(await ctxFor("u_owner"), { uid: "u_raj", role: "manager" });
    expect((await member("u_raj"))?.role).toBe("manager");
    await expect(
      changeRole(await ctxFor("u_owner", { staleAuth: true }), { uid: "u_raj", role: "admin" }),
    ).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    await changeRole(await ctxFor("u_owner"), { uid: "u_raj", role: "admin" });
    expect((await member("u_raj"))?.role).toBe("admin");
  });

  it("guards: no self change, no owner changes, admins can't touch admins", async () => {
    const owner = await ctxFor("u_owner");
    const admin = await ctxFor("u_admin");
    await expect(changeRole(owner, { uid: "u_owner", role: "admin" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(changeRole(admin, { uid: "u_owner", role: "member" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(changeRole(admin, { uid: "u_admin2", role: "member" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(changeRole(owner, { uid: "u_raj", role: "owner" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      changeRole(await ctxFor("u_mgr"), { uid: "u_raj", role: "viewer" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("role changes take effect on the very next request (no role caching)", async () => {
    const raj = await ctxFor("u_raj");
    expect(raj.role).toBe("member");
    await changeRole(await ctxFor("u_owner"), { uid: "u_raj", role: "viewer" });
    expect((await ctxFor("u_raj")).role).toBe("viewer");
  });
});

describe("removing members (TC-RBAC-003 AC3)", () => {
  it("reassigns records, removes access immediately, and revokes sessions for people with no other memberships", async () => {
    await addContact(getDb(), "acme", "c_raj_1", "u_raj");
    await addContact(getDb(), "acme", "c_raj_2", "u_raj");
    const rajIdToken = await signInWithPassword("u_raj@example.test", TEST_PASSWORD);
    const { cookie } = await createSessionCookie(
      rajIdToken,
      { kind: "workspace", host: HOST },
      false,
    );
    await new Promise((r) => setTimeout(r, 1100)); // revocation is second-granular

    const result = await removeMember(await ctxFor("u_owner"), {
      uid: "u_raj",
      reassignTo: "u_mgr",
    });
    expect(result.recordsReassigned).toBe(2);
    const contacts = await getDb().collection(`tenants/${TENANT}/contacts`).get();
    expect(contacts.docs.map((d) => d.get("ownerUid"))).toEqual(["u_mgr", "u_mgr"]);
    expect(await member("u_raj")).toBeUndefined();
    await expect(
      requireTenantContext({ host: HOST, sessionCookie: cookie, requestId: "r" }),
    ).rejects.toBeDefined();
    expect(await verifySession(cookie, { kind: "workspace", host: HOST })).toBeNull();
  });

  it("refuses to remove the owner, yourself, or (as admin) another admin; heir must be able to own records", async () => {
    const owner = await ctxFor("u_owner");
    const admin = await ctxFor("u_admin");
    await expect(
      removeMember(admin, { uid: "u_owner", reassignTo: "u_mgr" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      removeMember(owner, { uid: "u_owner", reassignTo: "u_mgr" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      removeMember(admin, { uid: "u_admin2", reassignTo: "u_mgr" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(removeMember(owner, { uid: "u_raj", reassignTo: "u_view" })).rejects.toMatchObject(
      { code: "VALIDATION" },
    );
    await expect(removeMember(owner, { uid: "u_raj", reassignTo: "u_raj" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("another workspace's member can't be targeted (TC-SEC-001)", async () => {
    await createUser(getAdminAuth(), "u_initech");
    await addMember(getDb(), "initech", "u_initech", "member");
    await expect(
      removeMember(await ctxFor("u_owner"), { uid: "u_initech", reassignTo: "u_mgr" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("forced sign-out and ownership transfer", () => {
  it("admins can sign out members but not owners or admins (TC-AUTH-005)", async () => {
    const admin = await ctxFor("u_admin");
    await forceSignOut(admin, "u_raj");
    await expect(forceSignOut(admin, "u_owner")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(forceSignOut(admin, "u_admin2")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("transfers ownership to an active admin only, with re-auth, keeping exactly one owner (TC-RBAC-005)", async () => {
    await expect(transferOwnership(await ctxFor("u_owner"), "u_mgr")).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      transferOwnership(await ctxFor("u_owner", { staleAuth: true }), "u_admin"),
    ).rejects.toMatchObject({
      code: "REAUTH_REQUIRED",
    });
    await expect(transferOwnership(await ctxFor("u_admin"), "u_admin2")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await transferOwnership(await ctxFor("u_owner"), "u_admin");
    expect((await member("u_owner"))?.role).toBe("admin");
    expect((await member("u_admin"))?.role).toBe("owner");
    expect((await getDb().doc(`tenants/${TENANT}`).get()).get("ownerUid")).toBe("u_admin");
    const owners = (
      await getDb().collection(`tenants/${TENANT}/members`).where("role", "==", "owner").get()
    ).size;
    expect(owners).toBe(1);
    const mails = await getDb()
      .collection("mailOutbox")
      .where("template", "==", "ownership_transferred")
      .get();
    expect(mails.size).toBe(2);
  });
});
