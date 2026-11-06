import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@crm/shared/permissions";
import { emailOverrideInput } from "@crm/shared/branding/schemas";
import { WORKSPACES, uidFor } from "@crm/testing/fixtures";
import { addMember, resetEmulators, seedTenancy } from "@crm/testing/seed";
import { clearTenantCaches, type TenantContext } from "../contexts/tenant-context";
import { getDb } from "../firebase-admin";
import { logger } from "../logger";
import { queueMailNow } from "../mail";
import { deliverQueuedMail, setMailProvider, type OutgoingMail } from "../mail-delivery";
import type { TenantDoc } from "../model";
import { MemoryRateLimiter, setRateLimiter } from "../rate-limit";
import { previewEmail, saveEmailOverride, sendTestEmail } from "./emails";

// Branded delivery, overrides, preview, and test send (TC-BRAND-003).

const ACME = WORKSPACES.acme;
let outbox: OutgoingMail[] = [];

async function ctx(role: WorkspaceRole = "owner"): Promise<TenantContext> {
  const tenant = (await getDb().doc(`tenants/${ACME.id}`).get()).data() as TenantDoc;
  return {
    tenantId: ACME.id,
    agencyId: ACME.agencyId,
    uid: uidFor("acme", role),
    role,
    session: {} as never,
    tenant,
    requestId: "req_test",
    log: logger,
  };
}

beforeEach(async () => {
  await resetEmulators();
  await seedTenancy(getDb());
  await addMember(getDb(), "acme", uidFor("acme", "owner"), "owner");
  await addMember(getDb(), "acme", uidFor("acme", "member"), "member");
  await getDb().doc(`tenants/${ACME.id}`).update({ "branding.appName": "Acme CRM" });
  clearTenantCaches();
  setRateLimiter(new MemoryRateLimiter());
  outbox = [];
  setMailProvider({
    name: "test",
    send: async (mail) => {
      outbox.push(mail);
      return { id: `t${outbox.length}` };
    },
  });
});
afterEach(() => setMailProvider(undefined));

describe("delivery", () => {
  it("renders queued mail with the workspace's resolved branding and overrides", async () => {
    await saveEmailOverride(
      await ctx(),
      emailOverrideInput.parse({
        template: "workspace_invitation",
        subject: "Welcome to {{tenant.name}}",
        intro: "We use {{tenant.name}} for every customer.",
      }),
    );
    await queueMailNow({
      template: "workspace_invitation",
      to: "new@acme.test",
      variables: { name: ACME.name, link: "http://crm.acme.test/invite/abc" },
      tenantId: ACME.id,
    });
    expect(await deliverQueuedMail()).toBe(1);
    expect(outbox[0]).toMatchObject({
      from: '"Acme CRM" <no-reply@mail.example.com>',
      to: "new@acme.test",
      subject: `Welcome to ${ACME.name}`,
    });
    expect(outbox[0]!.html).toContain(`We use ${ACME.name} for every customer.`);
    const doc = (await getDb().collection("mailOutbox").get()).docs[0]!.data();
    expect(doc).toMatchObject({ status: "sent", provider: "test" });
    // Already sent: a second run sends nothing.
    expect(await deliverQueuedMail()).toBe(0);
  });

  it("retries failures and gives up after 5 attempts", async () => {
    setMailProvider({ name: "down", send: async () => Promise.reject(new Error("503")) });
    await queueMailNow({
      template: "password_reset",
      to: "x@acme.test",
      variables: { link: "http://x/y" },
    });
    for (let i = 0; i < 5; i++) await deliverQueuedMail();
    const doc = (await getDb().collection("mailOutbox").get()).docs[0]!.data();
    expect(doc).toMatchObject({ status: "dead", attempts: 5 });
  });
});

describe("preview and test send", () => {
  it("previews unsaved drafts and requires branding.manage", async () => {
    const preview = await previewEmail(await ctx(), "workspace_invitation", {
      subject: "Hi from {{tenant.name}}",
      intro: null,
    });
    expect(preview.subject).toBe(`Hi from ${ACME.name}`);
    expect(preview.html).toContain("Acme CRM");
    await expect(previewEmail(await ctx("member"), "password_reset", null)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("sends tests only to the requester, max 10 per day", async () => {
    for (let i = 0; i < 10; i++) {
      expect(await sendTestEmail(await ctx(), "password_reset")).toEqual({
        email: `${uidFor("acme", "owner")}@example.test`,
      });
    }
    await expect(sendTestEmail(await ctx(), "password_reset")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(outbox.every((m) => m.to === `${uidFor("acme", "owner")}@example.test`)).toBe(true);
  });
});
