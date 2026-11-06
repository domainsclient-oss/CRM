import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENCIES, WORKSPACES } from "@crm/testing/fixtures";
import { addContact, addMember, resetEmulators, seedTenancy } from "@crm/testing/seed";
import { actionMeta, assertWorkspaceState } from "../actions/wrappers";
import { getDb } from "../firebase-admin";
import { logger } from "../logger";
import { canReadRecord, getById, scopedQuery } from "../repositories/base";
import {
  canonicalRedirectHost,
  clearTenantCaches,
  getPublicWorkspaceName,
  loadActiveWorkspace,
  type TenantContext,
} from "./tenant-context";

// Edge cases of the isolation core (T-09-05): host resolution, lifecycle gates, scoped reads.

const ACME = WORKSPACES.acme;
const ref = { tenantId: ACME.id, agencyId: ACME.agencyId, type: "platform_subdomain" as const };

beforeEach(async () => {
  await resetEmulators();
  await seedTenancy(getDb());
  clearTenantCaches();
});

describe("tenant resolution", () => {
  it("redirects a platform subdomain to another canonical host only", async () => {
    await getDb().doc(`tenantDomains/old.app.test`).set({
      tenantId: ACME.id,
      agencyId: ACME.agencyId,
      type: "platform_subdomain",
      status: "active",
      isCanonical: false,
    });
    expect(await canonicalRedirectHost("OLD.app.test")).toBe(ACME.canonicalHost);
    expect(await canonicalRedirectHost(ACME.canonicalHost)).toBeNull();
    expect(await canonicalRedirectHost("unknown.app.test")).toBeNull();
    expect(await canonicalRedirectHost("bad host!")).toBeNull();
  });

  it("refuses tenants whose agency doesn't match, and inactive agencies", async () => {
    await expect(loadActiveWorkspace({ ...ref, agencyId: "agy_other" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await getDb().doc(`agencies/${ACME.agencyId}`).update({ status: "suspended" });
    clearTenantCaches();
    await expect(loadActiveWorkspace(ref)).rejects.toMatchObject({ code: "TENANT_SUSPENDED" });
  });

  it("lets pending-deletion workspaces through only when asked", async () => {
    await getDb().doc(`tenants/${ACME.id}`).update({ status: "pending_deletion" });
    await expect(loadActiveWorkspace(ref)).rejects.toMatchObject({ code: "TENANT_SUSPENDED" });
    clearTenantCaches();
    await expect(loadActiveWorkspace(ref, { allowPendingDeletion: true })).resolves.toMatchObject({
      status: "pending_deletion",
    });
  });

  it("shows the public name only for usable workspaces", async () => {
    expect(await getPublicWorkspaceName(ACME.canonicalHost)).toBe(ACME.name);
    expect(await getPublicWorkspaceName("nope.app.test")).toBeNull();
    await getDb().doc(`tenants/${ACME.id}`).update({ status: "suspended" });
    clearTenantCaches();
    expect(await getPublicWorkspaceName(ACME.canonicalHost)).toBeNull();
  });
});

describe("lifecycle gates (FR-TEN-006 AC2)", () => {
  const ctx = (status: string) =>
    ({
      tenant: { status },
      agencyId: ACME.agencyId,
      tenantId: ACME.id,
    }) as unknown as TenantContext;

  it("allows only cancelling while deletion is pending", async () => {
    await expect(
      assertWorkspaceState(ctx("pending_deletion"), "contacts.save", "record.update"),
    ).rejects.toMatchObject({ code: "TENANT_SUSPENDED" });
    await expect(
      assertWorkspaceState(ctx("pending_deletion"), "tenant.cancelDeletion", "tenant.delete"),
    ).resolves.toBeUndefined();
  });

  it("only marks wrapped functions as actions", () => {
    expect(actionMeta("not a function")).toBeUndefined();
    expect(actionMeta(() => 1)).toBeUndefined();
  });
});

describe("scoped repository (ADR-023)", () => {
  const repo = (role: string, uid = "u_raj") => ({ tenantId: ACME.id, uid, role: role as never });

  it("denies roles without read access", () => {
    expect(() => scopedQuery(repo("nonexistent"), "contacts")).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });

  it("decides record visibility by scope", () => {
    expect(canReadRecord(repo("member"), "activities", {})).toBe(true); // not owner-scoped
    expect(canReadRecord(repo("member"), "contacts", { ownerUid: "u_raj" })).toBe(true);
    expect(canReadRecord(repo("member"), "contacts", { ownerUid: "u_lena" })).toBe(false);
    expect(canReadRecord(repo("owner"), "contacts", { ownerUid: "u_lena" })).toBe(true);
    expect(canReadRecord(repo("nonexistent"), "contacts", { ownerUid: "u_raj" })).toBe(false);
  });

  it("treats foreign-tenant, deleted and hidden records as not found", async () => {
    await addMember(getDb(), "acme", "u_raj", "member");
    await addContact(getDb(), "acme", "ct_mine", "u_raj");
    await addContact(getDb(), "acme", "ct_other", "u_lena");
    await getDb()
      .doc(`tenants/${ACME.id}/contacts/ct_foreign`)
      .set({ tenantId: WORKSPACES.globex.id, ownerUid: "u_raj", isDeleted: false });
    await getDb()
      .doc(`tenants/${ACME.id}/contacts/ct_deleted`)
      .set({ tenantId: ACME.id, ownerUid: "u_raj", isDeleted: true });
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});
    await expect(getById(repo("member"), "contacts", "ct_mine")).resolves.toMatchObject({
      id: "ct_mine",
    });
    for (const id of ["ct_other", "ct_foreign", "ct_deleted", "ct_missing"]) {
      await expect(getById(repo("member"), "contacts", id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
    expect(spy).toHaveBeenCalledWith(
      "tenant_mismatch",
      expect.objectContaining({ id: "ct_foreign" }),
    );
    spy.mockRestore();
    expect(AGENCIES.agencyOne.id).toBeTruthy();
  });
});
