import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WORKSPACES, uidFor } from "@crm/testing/fixtures";
import { addMember, createUser, resetEmulators, seedTenancy } from "@crm/testing/seed";
import { defineMarketingActions } from "./actions/marketing-actions";
import { createActionWrappers, type RequestInfo } from "./actions/wrappers";
import { clearTenantCaches } from "./contexts/tenant-context";
import { getAdminAuth, getDb } from "./firebase-admin";
import { setMailProvider, type OutgoingMail } from "./mail-delivery";
import { workspaceHostsForEmail } from "./marketing";
import { MemoryRateLimiter, setRateLimiter } from "./rate-limit";

// Public marketing actions (T-08-01): demo requests and "find your workspace" (FR-PUB-001).

const HOST = "localhost:3000";
const request: RequestInfo = {
  host: HOST,
  origin: `http://${HOST}`,
  secure: false,
  ip: "203.0.113.20",
  userAgent: "vitest",
  cookie: () => undefined,
};
const { submitContactAction, findWorkspaceAction } = defineMarketingActions(
  createActionWrappers(async () => request),
);
const OWNER = uidFor("acme", "owner");
const EMAIL = `${OWNER}@example.test`;
let mail: OutgoingMail[] = [];

const contact = {
  name: "Dana Rivera",
  email: "dana@agency.test",
  company: "Rivera Digital",
  teamSize: "6-20",
  message: "Interested in custom domains.",
};

beforeEach(async () => {
  await resetEmulators();
  await seedTenancy(getDb());
  await createUser(getAdminAuth(), OWNER);
  await addMember(getDb(), "acme", OWNER, "owner");
  await addMember(getDb(), "globex", OWNER, "member");
  await getDb()
    .doc(`users/${OWNER}`)
    .set({ tenantIds: [WORKSPACES.acme.id, WORKSPACES.globex.id], agencyIds: [] }, { merge: true });
  setRateLimiter(new MemoryRateLimiter());
  clearTenantCaches();
  mail = [];
  setMailProvider({ name: "test", send: async (m) => (mail.push(m), { id: String(mail.length) }) });
});
afterEach(() => setMailProvider(undefined));

describe("demo requests", () => {
  it("stores the request with a retention date", async () => {
    expect(await submitContactAction(contact)).toEqual({ ok: true, data: { received: true } });
    const docs = (await getDb().collection("contactRequests").get()).docs.map((d) => d.data());
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ ...contact, status: "new" });
    expect(docs[0]?.expireAt).toBeDefined();
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({
      to: contact.email,
      subject: "We received your demo request",
    });
    expect(mail[0]?.text).toContain(`Hi ${contact.name}, we received your request`);
    const outbox = (await getDb().collection("mailOutbox").get()).docs[0]?.data();
    expect(outbox).toMatchObject({
      template: "demo_request_confirmation",
      to: contact.email,
      status: "sent",
    });
  });

  it("answers bots that fill the honeypot identically but stores nothing", async () => {
    expect(await submitContactAction({ ...contact, website: "http://spam.test" })).toEqual({
      ok: true,
      data: { received: true },
    });
    expect((await getDb().collection("contactRequests").get()).size).toBe(0);
    expect((await getDb().collection("mailOutbox").get()).size).toBe(0);
    expect(mail).toHaveLength(0);
  });

  it("rejects unknown keys and invalid team sizes", async () => {
    expect(await submitContactAction({ ...contact, status: "won" })).toMatchObject({ ok: false });
    expect(await submitContactAction({ ...contact, teamSize: "9000" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });

  it("is rate limited per IP", async () => {
    for (let i = 0; i < 5; i++) expect((await submitContactAction(contact)).ok).toBe(true);
    expect(await submitContactAction(contact)).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED" },
    });
  });
});

describe("find your workspace (FR-PUB-001)", () => {
  it("lists only active workspaces with an active membership", async () => {
    expect(await workspaceHostsForEmail(EMAIL)).toEqual(
      [WORKSPACES.acme.canonicalHost, WORKSPACES.globex.canonicalHost].sort(),
    );
    await getDb().doc(`tenants/${WORKSPACES.globex.id}`).update({ status: "suspended" });
    await getDb()
      .doc(`tenants/${WORKSPACES.acme.id}/members/${OWNER}`)
      .update({ status: "disabled" });
    expect(await workspaceHostsForEmail(EMAIL)).toEqual([]);
  });

  it("emails the links, and answers unknown addresses identically without sending", async () => {
    const known = await findWorkspaceAction({ email: EMAIL });
    const unknown = await findWorkspaceAction({ email: "nobody@example.test" });
    expect(known).toEqual({ ok: true, data: { sent: true } });
    expect(unknown).toEqual(known);
    expect(mail).toHaveLength(1);
    expect(mail[0]?.to).toBe(EMAIL);
    expect(mail[0]?.text).toContain(`https://${WORKSPACES.acme.canonicalHost}`);
  });

  it("limits requests per address", async () => {
    for (let i = 0; i < 3; i++) expect((await findWorkspaceAction({ email: EMAIL })).ok).toBe(true);
    expect(await findWorkspaceAction({ email: EMAIL })).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED" },
    });
  });
});
