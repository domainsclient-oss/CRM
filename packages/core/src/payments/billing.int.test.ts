import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { AGENCIES, WORKSPACES, buildAgency } from "@crm/testing/fixtures";
import { addMember, resetEmulators, seedTenancy } from "@crm/testing/seed";
import type { AgencyContext } from "../contexts/agency-context";
import { clearTenantCaches, type TenantContext } from "../contexts/tenant-context";
import { getDb } from "../firebase-admin";
import { logger } from "../logger";
import type { AgencyDoc, TenantDoc } from "../model";
import { MemoryRateLimiter, setRateLimiter } from "../rate-limit";
import { setMockSubscription, signMockWebhook } from "./mock";
import { setSecretStore } from "./secrets";
import {
  PAST_DUE_GRACE_MS,
  cancelSubscription,
  configureGateway,
  deriveBillingState,
  getBillingOverview,
  getGatewaySettings,
  receiveWebhook,
  reconcileBilling,
  setManualBilling,
  setPlanPrice,
  startCheckout,
  type SubscriptionDoc,
} from "./service";

// Workspace billing against the mock gateway (TC-BILL-002..005, TC-BILL-003 webhook security).

process.env.TEST_GATEWAY_MOCKS = "true";
afterAll(() => {
  delete process.env.TEST_GATEWAY_MOCKS;
});

const AGENCY = AGENCIES.agencyOne;
const ACME = WORKSPACES.acme; // in Agency One
const OWNER = "u_bill_owner";
const WEBHOOK_SECRET = "whsec_mock_secret_value";
const now = () => Math.floor(Date.now() / 1000);

async function agencyCtx(
  role: AgencyContext["role"] = "agency_owner",
  authAgeSec = 0,
): Promise<AgencyContext> {
  const agency = (await getDb().doc(`agencies/${AGENCY.id}`).get()).data() as AgencyDoc;
  return {
    agencyId: AGENCY.id,
    uid: AGENCY.ownerUid,
    role,
    session: { uid: AGENCY.ownerUid, authTime: now() - authAgeSec } as never,
    agency,
    requestId: "r",
    log: logger,
  };
}

async function tenantCtx(role: TenantContext["role"] = "owner"): Promise<TenantContext> {
  const tenant = (await getDb().doc(`tenants/${ACME.id}`).get()).data() as TenantDoc;
  return {
    tenantId: ACME.id,
    agencyId: ACME.agencyId,
    uid: OWNER,
    role,
    session: { uid: OWNER, authTime: now() } as never,
    tenant,
    requestId: "r",
    log: logger,
  };
}

const tenant = async () => (await getDb().doc(`tenants/${ACME.id}`).get()).data() as TenantDoc;

async function webhook(
  event: { id: string; type: string; subscriptionId: string },
  secret = WEBHOOK_SECRET,
  agencyId: string = AGENCY.id,
) {
  const { body, headers } = signMockWebhook(secret, event);
  return receiveWebhook("razorpay", agencyId, body, new Headers(headers), "r");
}

/** Configure the gateway, map the growth plan, start checkout; returns the mock subscription ID. */
async function subscribe(): Promise<string> {
  await configureGateway(await agencyCtx(), {
    provider: "razorpay",
    env: "test",
    keyId: "rzp_test_KEY1234",
    keySecret: "secret",
    webhookSecret: WEBHOOK_SECRET,
  });
  await setPlanPrice(await agencyCtx(), {
    planId: "growth",
    gatewayPlanId: "plan_249900_USD_month",
  });
  const { url } = await startCheckout(await tenantCtx(), "growth");
  return new URL(url).searchParams.get("mock_subscription")!;
}

beforeEach(async () => {
  await resetEmulators();
  await seedTenancy(getDb());
  await addMember(getDb(), "acme", OWNER, "owner", { email: "owner@acme.test" });
  await getDb()
    .doc(`tenants/${ACME.id}`)
    .update({ ownerUid: OWNER, billingState: "trialing", planId: "trial" });
  await getDb().doc(`agencies/${AGENCY.id}/staff/${AGENCY.ownerUid}`).set({
    uid: AGENCY.ownerUid,
    role: "agency_owner",
    status: "active",
    email: "priya@agency-one.test",
  });
  setRateLimiter(new MemoryRateLimiter());
  setSecretStore(undefined);
  clearTenantCaches();
});

describe("deriveBillingState (FR-BILL-002 AC3, FR-BILL-005)", () => {
  const t = new Date("2026-11-05T00:00:00Z");
  const ts = (offsetMs: number) => Timestamp.fromMillis(t.getTime() + offsetMs);
  const sub = (s: Partial<SubscriptionDoc>): SubscriptionDoc => ({
    provider: "razorpay",
    planId: "growth",
    status: "active",
    ...s,
  });
  it.each([
    ["active", sub({}), "active"],
    ["pending keeps the trial", sub({ status: "pending" }), "trialing"],
    [
      "past due within grace",
      sub({ status: "past_due", pastDueSince: ts(-PAST_DUE_GRACE_MS + 1000) }),
      "past_due",
    ],
    [
      "past due beyond grace",
      sub({ status: "past_due", pastDueSince: ts(-PAST_DUE_GRACE_MS - 1000) }),
      "read_only",
    ],
    ["unpaid", sub({ status: "unpaid" }), "read_only"],
    [
      "cancelled, period still paid",
      sub({ status: "cancelled", currentPeriodEnd: ts(86_400_000) }),
      "active",
    ],
    ["cancelled, period over", sub({ status: "cancelled", currentPeriodEnd: ts(-1) }), "read_only"],
    [
      "manual paid",
      sub({ mode: "manual", status: "manual", paidUntil: ts(86_400_000) }),
      "manual_active",
    ],
    [
      "manual expired within grace",
      sub({ mode: "manual", status: "manual", paidUntil: ts(-86_400_000) }),
      "past_due",
    ],
    [
      "manual expired beyond grace",
      sub({ mode: "manual", status: "manual", paidUntil: ts(-PAST_DUE_GRACE_MS - 1) }),
      "read_only",
    ],
  ] as const)("%s", (_label, s, expected) => {
    expect(deriveBillingState(s, t, "trialing")).toBe(expected);
  });
});

describe("gateway configuration (FR-BILL-001, T27)", () => {
  it("stores secrets outside the agency document, masks the key, alerts the owner", async () => {
    await configureGateway(await agencyCtx(), {
      provider: "razorpay",
      env: "test",
      keyId: "rzp_test_KEY1234",
      keySecret: "s3cret-value",
      webhookSecret: WEBHOOK_SECRET,
    });
    const agency = (await getDb().doc(`agencies/${AGENCY.id}`).get()).data()!;
    expect(JSON.stringify(agency)).not.toContain("s3cret-value");
    expect(JSON.stringify(agency)).not.toContain(WEBHOOK_SECRET);
    expect(agency.billing.secretRefs.keySecret).toMatch(/^local\/agy_/);
    const settings = await getGatewaySettings(await agencyCtx());
    expect(settings).toMatchObject({ provider: "razorpay", keyIdHint: "1234", configured: true });
    expect(JSON.stringify(settings)).not.toContain("rzp_test_KEY1234");
    const mail = await getDb()
      .collection("mailOutbox")
      .where("template", "==", "gateway_credentials_changed")
      .get();
    expect(mail.size).toBe(1);
    const audits = await getDb()
      .collection("platformAuditLogs")
      .where("action", "==", "billing.gateway_configured")
      .get();
    expect(audits.size).toBe(1);
  });

  it("requires the agency owner and a recent sign-in", async () => {
    const input = {
      provider: "razorpay" as const,
      env: "test" as const,
      keyId: "k1234",
      keySecret: "s1234",
      webhookSecret: "w1234",
    };
    await expect(configureGateway(await agencyCtx("agency_admin"), input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      configureGateway(await agencyCtx("agency_owner", 3600), input),
    ).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
  });

  it("validates plan prices against the gateway and the agency currency", async () => {
    await configureGateway(await agencyCtx(), {
      provider: "razorpay",
      env: "test",
      keyId: "k1234",
      keySecret: "s1234",
      webhookSecret: "w1234",
    });
    await expect(
      setPlanPrice(await agencyCtx(), { planId: "growth", gatewayPlanId: "plan_100_INR_month" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      setPlanPrice(await agencyCtx(), { planId: "growth", gatewayPlanId: "nope" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      setPlanPrice(await agencyCtx(), { planId: "trial", gatewayPlanId: "plan_1_USD_month" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      setPlanPrice(await agencyCtx(), { planId: "growth", gatewayPlanId: "plan_249900_USD_month" }),
    ).resolves.toMatchObject({ amount: 249900, currency: "USD", interval: "month" });
  });
});

describe("subscription lifecycle (FR-BILL-002/003/004)", () => {
  it("only a verified webhook + gateway state activates the plan", async () => {
    const subId = await subscribe();
    expect((await tenant()).billingState).toBe("trialing"); // the redirect alone changes nothing

    // Payload claims payment, but the gateway still says pending: no change.
    expect(await webhook({ id: "evt_1", type: "payment", subscriptionId: subId })).toEqual({
      status: 200,
      result: "stored",
    });
    expect((await tenant()).billingState).toBe("trialing");

    await setMockSubscription(subId, {
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    });
    await webhook({ id: "evt_2", type: "payment", subscriptionId: subId });
    expect(await tenant()).toMatchObject({ billingState: "active", planId: "growth" });

    const overview = await getBillingOverview(await tenantCtx());
    expect(overview).toMatchObject({
      planId: "growth",
      billingState: "active",
      status: "active",
      mode: "gateway",
    });
    expect(overview.history.map((h) => [h.amount, h.currency])).toEqual([
      [249900, "USD"],
      [249900, "USD"],
    ]);
    const mail = await getDb()
      .collection("mailOutbox")
      .where("template", "==", "billing_status_changed")
      .get();
    expect(mail.size).toBe(1);
  });

  it("rejects forged, foreign-agency and replayed webhooks (TC-BILL-003)", async () => {
    const subId = await subscribe();
    await setMockSubscription(subId, { status: "active" });
    expect(
      await webhook({ id: "evt_f", type: "payment", subscriptionId: subId }, "wrong-secret"),
    ).toEqual({ status: 400, result: "invalid" });
    expect((await tenant()).billingState).toBe("trialing");

    // Agency Two's URL can't touch Agency One's subscription, even with a valid signature for it.
    const two = buildAgency("agencyTwo");
    expect(
      await webhook(
        { id: "evt_x", type: "payment", subscriptionId: subId },
        WEBHOOK_SECRET,
        two.id,
      ),
    ).toMatchObject({ status: 404 });

    // Unknown subscription: stored as ignored, no workspace touched.
    expect(
      await webhook({ id: "evt_u", type: "payment", subscriptionId: "sub_mock_unknown" }),
    ).toEqual({ status: 200, result: "ignored" });

    expect(await webhook({ id: "evt_ok", type: "payment", subscriptionId: subId })).toEqual({
      status: 200,
      result: "stored",
    });
    expect(await webhook({ id: "evt_ok", type: "payment", subscriptionId: subId })).toEqual({
      status: 200,
      result: "duplicate",
    });
    const history = await getDb().collection(`tenants/${ACME.id}/billingHistory`).get();
    expect(history.size).toBe(1);
    const events = await getDb().collection("paymentEvents").get();
    expect(events.docs.every((d) => !JSON.stringify(d.data()).includes("@"))).toBe(true);
  });

  it("past due → read-only after the grace period; cancellation keeps the paid period", async () => {
    const subId = await subscribe();
    await setMockSubscription(subId, { status: "past_due" });
    await webhook({ id: "evt_pd", type: "subscription.pending", subscriptionId: subId });
    expect((await tenant()).billingState).toBe("past_due");
    await getDb()
      .doc(`tenants/${ACME.id}/billing/subscription`)
      .update({ pastDueSince: Timestamp.fromMillis(Date.now() - PAST_DUE_GRACE_MS - 60_000) });
    const report = await reconcileBilling();
    expect(report).toMatchObject({ failed: 0 });
    expect((await tenant()).billingState).toBe("read_only");

    await setMockSubscription(subId, {
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
    });
    await reconcileBilling();
    expect((await tenant()).billingState).toBe("active");

    await cancelSubscription(await tenantCtx());
    expect((await tenant()).billingState).toBe("active"); // paid until period end
    await setMockSubscription(subId, { currentPeriodEnd: new Date(Date.now() - 1000) });
    await reconcileBilling();
    expect((await tenant()).billingState).toBe("read_only");
  });

  it("refuses checkout for unknown plans, a second subscription, and non-owners", async () => {
    const subId = await subscribe();
    await expect(startCheckout(await tenantCtx(), "enterprise")).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await setMockSubscription(subId, { status: "active" });
    await webhook({ id: "evt_a", type: "payment", subscriptionId: subId });
    await expect(startCheckout(await tenantCtx(), "growth")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(startCheckout(await tenantCtx("admin"), "growth")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("manual billing (FR-BILL-005)", () => {
  it("sets plan and paid-until for the agency's own workspaces only, then expires", async () => {
    await setManualBilling(await agencyCtx(), ACME.id, {
      planId: "starter",
      paidUntil: "2099-01-01",
    });
    expect(await tenant()).toMatchObject({ planId: "starter", billingState: "manual_active" });

    const foreign = Object.values(WORKSPACES).find((w) => w.agencyId !== AGENCY.id)!;
    await expect(
      setManualBilling(await agencyCtx(), foreign.id, {
        planId: "starter",
        paidUntil: "2099-01-01",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await getDb()
      .doc(`tenants/${ACME.id}/billing/subscription`)
      .update({ paidUntil: Timestamp.fromMillis(Date.now() - PAST_DUE_GRACE_MS - 86_400_000) });
    await reconcileBilling();
    expect((await tenant()).billingState).toBe("read_only");
    const audits = await getDb()
      .collection(`tenants/${ACME.id}/auditLogs`)
      .where("action", "in", ["billing.manual_set", "billing.state_changed"])
      .get();
    expect(audits.size).toBe(2);
  });
});
