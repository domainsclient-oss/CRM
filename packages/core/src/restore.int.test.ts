import { beforeEach, describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { WORKSPACES } from "@crm/testing/fixtures";
import { addContact, addMember, resetEmulators, seedTenancy } from "@crm/testing/seed";
import type { TenantContext } from "./contexts/tenant-context";
import { getDb, getNamedDb } from "./firebase-admin";
import { logger } from "./logger";
import { eraseContact, reapplyErasures } from "./privacy";
import { checksum, compareDatabases } from "./restore";

// Restore drill building blocks (T-10-04, R-09): database comparison and erasure re-application.

const ACME = WORKSPACES.acme;
const OWNER = "u_owner_restore";

async function ctx(): Promise<TenantContext> {
  const tenant = (await getDb().doc(`tenants/${ACME.id}`).get()).data();
  return {
    tenantId: ACME.id,
    agencyId: ACME.agencyId,
    uid: OWNER,
    role: "owner",
    session: { uid: OWNER, authTime: Math.floor(Date.now() / 1000) } as never,
    tenant: tenant as never,
    requestId: "r",
    log: logger,
  };
}

/** Copies the given documents verbatim, as a backup restore would. */
async function copyTo(target: FirebaseFirestore.Firestore, paths: string[]) {
  for (const path of paths) {
    const snap = await getDb().doc(path).get();
    if (snap.exists) await target.doc(path).set(snap.data()!);
  }
}

beforeEach(async () => {
  await resetEmulators();
  const restored = getNamedDb("restored");
  for (const col of await restored.listCollections()) await restored.recursiveDelete(col);
  await seedTenancy(getDb());
  await addMember(getDb(), "acme", OWNER, "owner");
  await addContact(getDb(), "acme", "ct_keep", OWNER);
  await addContact(getDb(), "acme", "ct_gone", OWNER);
});

describe("compareDatabases", () => {
  it("reports matching copies, missing documents and changed documents", async () => {
    const restored = getNamedDb("restored");
    const paths = [
      `tenants/${ACME.id}`,
      `tenants/${ACME.id}/members/${OWNER}`,
      `tenants/${ACME.id}/contacts/ct_keep`,
      `tenants/${ACME.id}/contacts/ct_gone`,
    ];
    await copyTo(restored, paths);
    let report = await compareDatabases(getDb(), restored, { tenantIds: [ACME.id] });
    expect(report.countMismatches).toEqual([]);
    expect(report.checksumMismatches).toEqual([]);

    await restored.doc(`tenants/${ACME.id}/contacts/ct_gone`).delete();
    await restored.doc(`tenants/${ACME.id}/contacts/ct_keep`).update({ firstName: "Changed" });
    report = await compareDatabases(getDb(), restored, { tenantIds: [ACME.id] });
    expect(report.countMismatches).toEqual([
      expect.objectContaining({ collection: "contacts", source: 2, restored: 1 }),
    ]);
    const contacts = report.checksumMismatches.find((d) => d.collection === "contacts")!;
    expect(contacts.checksumMismatches.sort()).toEqual(["ct_gone", "ct_keep"]);
    expect(JSON.stringify(report)).not.toContain("Changed"); // ids and numbers only
  });

  it("checksums are stable for equal data regardless of key order and timestamps", () => {
    const t = Timestamp.fromMillis(1000);
    expect(checksum({ a: 1, b: { c: t } })).toBe(
      checksum({ b: { c: Timestamp.fromMillis(1000) }, a: 1 }),
    );
    expect(checksum({ a: 1 })).not.toBe(checksum({ a: 2 }));
  });
});

describe("reapplyErasures (R-09)", () => {
  it("erases again contacts that a restore brought back, without logging them twice", async () => {
    const backupTime = new Date(Date.now() - 1000);
    const snapshot = (await getDb().doc(`tenants/${ACME.id}/contacts/ct_gone`).get()).data()!;
    await eraseContact(await ctx(), "ct_gone");
    expect((await getDb().collection("erasureLog").get()).size).toBe(1);

    // The restore brings the erased contact back.
    await getDb().doc(`tenants/${ACME.id}/contacts/ct_gone`).set(snapshot);

    await expect(reapplyErasures(backupTime, { dryRun: true })).resolves.toEqual({
      entries: 1,
      tenants: 1,
      erased: 1,
    });
    expect((await getDb().doc(`tenants/${ACME.id}/contacts/ct_gone`).get()).exists).toBe(true);

    await expect(reapplyErasures(backupTime)).resolves.toMatchObject({ erased: 1 });
    expect((await getDb().doc(`tenants/${ACME.id}/contacts/ct_gone`).get()).exists).toBe(false);
    expect((await getDb().doc(`tenants/${ACME.id}/contacts/ct_keep`).get()).exists).toBe(true);
    expect((await getDb().collection("erasureLog").get()).size).toBe(1);
    const audits = await getDb().collection(`tenants/${ACME.id}/auditLogs`).get();
    expect(audits.docs.map((d) => d.get("action"))).toContain("privacy.erasure_reapplied");

    // Idempotent; erasures before the backup time are not re-applied.
    await expect(reapplyErasures(backupTime)).resolves.toMatchObject({ erased: 0 });
    await expect(reapplyErasures(new Date())).resolves.toMatchObject({ entries: 0 });
  });
});
