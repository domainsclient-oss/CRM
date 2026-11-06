import "server-only";
import { FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { audit, auditNow } from "../audit";
import { authorize, authorizeAgency } from "../authz";
import type { AgencyContext } from "../contexts/agency-context";
import { clearTenantCaches, type TenantContext } from "../contexts/tenant-context";
import { PLAN_IDS, type PlanId } from "../config/entitlements";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../errors";
import { getDb } from "../firebase-admin";
import { jobsRunInline } from "../jobs/runner";
import { logger } from "../logger";
import { queueMail } from "../mail";
import type { AgencyDoc, MemberDoc, TenantDoc } from "../model";
import { assertSafeId } from "../repositories/base";
import { assertRecentAuth } from "../session";
import { getServerEnv } from "../server-env";
import { hostUrl } from "../urls";
import { MockGateway } from "./mock";
import { PayPalGateway } from "./paypal";
import { RazorpayGateway } from "./razorpay";
import { forgetSecret, getSecretStore, readSecret } from "./secrets";
import { StripeGateway } from "./stripe";
import {
  CHECKOUT_HOSTS,
  GatewayError,
  PAYMENT_PROVIDERS,
  type GatewayCredentials,
  type GatewayEnv,
  type GatewaySubscription,
  type NormalizedStatus,
  type PaymentGateway,
  type PaymentProvider,
} from "./types";

// Workspace billing (FR-BILL-001..005, ADR-021). Entitlements change only from gateway state that we
// fetched ourselves after a verified webhook or reconciliation — never from a redirect or a payload.

export const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const EVENT_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export type BillingState = TenantDoc["billingState"];

export interface SubscriptionDoc {
  mode?: "gateway" | "manual";
  provider: PaymentProvider | null;
  planId: string;
  status: NormalizedStatus | "trialing" | "manual";
  providerStatus?: string | null;
  subscriptionId?: string | null;
  pendingSubscriptionId?: string | null;
  currentPeriodEnd?: Timestamp | null;
  pastDueSince?: Timestamp | null;
  paidUntil?: Timestamp | null;
  cancelAtPeriodEnd?: boolean;
}

type AgencyBilling = AgencyDoc["billing"] & {
  secretRefs?: { keyId: string; keySecret: string; webhookSecret: string };
  keyIdHint?: string;
};

// ---------------------------------------------------------------- state machine (pure)

/** FR-BILL-002 AC3 / FR-BILL-005: billing state from the subscription record at `now`. */
export function deriveBillingState(
  sub: SubscriptionDoc,
  now: Date,
  current: BillingState,
): BillingState {
  const t = now.getTime();
  const ms = (ts: Timestamp | null | undefined) => (ts ? ts.toMillis() : null);
  if (sub.mode === "manual" || sub.status === "manual") {
    const until = ms(sub.paidUntil);
    if (until === null) return current;
    if (until >= t) return "manual_active";
    return t - until <= PAST_DUE_GRACE_MS ? "past_due" : "read_only";
  }
  switch (sub.status) {
    case "trialing":
    case "pending":
      return current; // nothing paid yet: keep the trial (and its own expiry) as is
    case "active":
      return "active";
    case "past_due": {
      const since = ms(sub.pastDueSince) ?? t;
      return t - since <= PAST_DUE_GRACE_MS ? "past_due" : "read_only";
    }
    case "unpaid":
      return "read_only";
    case "cancelled": {
      const end = ms(sub.currentPeriodEnd);
      return end !== null && end > t ? "active" : "read_only";
    }
  }
  return current;
}

// ---------------------------------------------------------------- gateways

function gatewayFrom(provider: PaymentProvider, creds: GatewayCredentials): PaymentGateway {
  if (getServerEnv().TEST_GATEWAY_MOCKS === "true") return new MockGateway(provider, creds);
  if (provider === "razorpay") return new RazorpayGateway(creds);
  if (provider === "stripe") return new StripeGateway(creds);
  return new PayPalGateway(creds);
}

async function agencyGateway(agency: AgencyDoc): Promise<PaymentGateway> {
  const billing = agency.billing as AgencyBilling;
  if (billing.mode !== "gateway" || !billing.provider || !billing.secretRefs) {
    throw new ConflictError("no_gateway");
  }
  const refs = billing.secretRefs;
  const [keyId, keySecret, webhookSecret] = await Promise.all([
    readSecret(refs.keyId),
    readSecret(refs.keySecret),
    readSecret(refs.webhookSecret),
  ]);
  return gatewayFrom(billing.provider as PaymentProvider, {
    keyId,
    keySecret,
    webhookSecret,
    env: billing.env,
  });
}

async function loadAgency(agencyId: string): Promise<AgencyDoc> {
  assertSafeId(agencyId);
  const agency = (await getDb().doc(`agencies/${agencyId}`).get()).data() as AgencyDoc | undefined;
  if (!agency) throw new NotFoundError();
  return agency;
}

function mapGatewayError(error: unknown): never {
  if (error instanceof GatewayError) {
    logger.warn("payment.gateway_error", {
      provider: error.provider,
      status: error.status,
      code: error.message,
    });
    throw new AppError("VALIDATION", "gateway_error", {
      _form: ["The payment gateway refused the request. Check the gateway settings and try again."],
    });
  }
  throw error;
}

// ---------------------------------------------------------------- agency configuration

export const gatewayConfigSchema = z.strictObject({
  provider: z.enum(PAYMENT_PROVIDERS),
  env: z.enum(["test", "live"]),
  keyId: z.string().trim().min(4).max(400),
  keySecret: z.string().trim().max(400),
  webhookSecret: z.string().trim().min(4).max(400),
});

/** FR-BILL-001 AC2 / T27: agency owner + recent sign-in; secrets go to the secret store only. */
export async function configureGateway(
  ctx: AgencyContext,
  input: z.infer<typeof gatewayConfigSchema>,
) {
  authorizeAgency(ctx, "agency.billing.manage");
  assertRecentAuth(ctx.session);
  if (input.provider !== "stripe" && input.keySecret.length < 4) {
    throw new ValidationError({ keySecret: ["Enter the secret from your gateway dashboard"] });
  }
  const store = getSecretStore();
  const base = `agy_${ctx.agencyId}-${input.provider}`;
  const [keyId, keySecret, webhookSecret] = await Promise.all([
    store.put(`${base}-key-id`, input.keyId),
    store.put(`${base}-key-secret`, input.keySecret || "-"),
    store.put(`${base}-webhook-secret`, input.webhookSecret),
  ]);
  for (const ref of [keyId, keySecret, webhookSecret]) forgetSecret(ref);
  const owner = await ownerEmailOfAgency(ctx.agencyId);
  const batch = getDb().batch();
  batch.update(getDb().doc(`agencies/${ctx.agencyId}`), {
    "billing.mode": "gateway",
    "billing.provider": input.provider,
    "billing.env": input.env,
    "billing.secretRefs": { keyId, keySecret, webhookSecret },
    "billing.keyIdHint": input.keyId.slice(-4),
    "billing.configuredAt": FieldValue.serverTimestamp(),
  });
  audit(
    batch,
    { agencyId: ctx.agencyId },
    {
      action: "billing.gateway_configured",
      actor: { type: "agency_staff", uid: ctx.uid },
      target: { type: "agency", id: ctx.agencyId },
      meta: { provider: input.provider, env: input.env },
      requestId: ctx.requestId,
    },
  );
  audit(
    batch,
    { platform: true },
    {
      action: "billing.gateway_configured",
      actor: { type: "agency_staff", uid: ctx.uid },
      target: { type: "agency", id: ctx.agencyId },
      meta: { provider: input.provider, env: input.env },
      requestId: ctx.requestId,
    },
  );
  if (owner) {
    queueMail(batch, {
      template: "gateway_credentials_changed",
      to: owner,
      variables: { name: ctx.agency.name, provider: input.provider, env: input.env },
      agencyId: ctx.agencyId,
    });
  }
  await batch.commit();
  return { provider: input.provider, env: input.env, keyIdHint: input.keyId.slice(-4) };
}

async function ownerEmailOfAgency(agencyId: string): Promise<string | null> {
  const owners = await getDb()
    .collection(`agencies/${agencyId}/staff`)
    .where("role", "==", "agency_owner")
    .limit(1)
    .get();
  return (owners.docs[0]?.get("email") as string | undefined) ?? null;
}

export interface PlanPrice {
  planId: PlanId;
  gatewayPlanId: string;
  provider: PaymentProvider;
  amount: number;
  currency: string;
  interval: "month" | "year";
  active: boolean;
}

/** FR-BILL-001 AC3: map a plan template to a gateway plan, validated against the gateway. */
export async function setPlanPrice(
  ctx: AgencyContext,
  input: { planId: string; gatewayPlanId: string },
): Promise<PlanPrice> {
  authorizeAgency(ctx, "agency.billing.manage");
  if (!(PLAN_IDS as string[]).includes(input.planId) || input.planId === "trial") {
    throw new ValidationError({ planId: ["Choose a paid plan"] });
  }
  const agency = await loadAgency(ctx.agencyId);
  const gateway = await agencyGateway(agency);
  const plan = await gateway.fetchPlan(input.gatewayPlanId).catch(mapGatewayError);
  if (plan.currency !== agency.billing.currency) {
    throw new ValidationError({
      gatewayPlanId: [
        `This plan is in ${plan.currency}; the agency bills in ${agency.billing.currency}`,
      ],
    });
  }
  const price: PlanPrice = {
    planId: input.planId as PlanId,
    gatewayPlanId: plan.id,
    provider: gateway.provider,
    amount: plan.amountMinor,
    currency: plan.currency,
    interval: plan.interval,
    active: true,
  };
  const batch = getDb().batch();
  batch.set(getDb().doc(`agencies/${ctx.agencyId}/planPrices/${input.planId}`), {
    ...price,
    validatedAt: FieldValue.serverTimestamp(),
  });
  audit(
    batch,
    { agencyId: ctx.agencyId },
    {
      action: "billing.price_set",
      actor: { type: "agency_staff", uid: ctx.uid },
      target: { type: "plan", id: input.planId },
      meta: { provider: price.provider, interval: price.interval, currency: price.currency },
      requestId: ctx.requestId,
    },
  );
  await batch.commit();
  return price;
}

export async function removePlanPrice(ctx: AgencyContext, planId: string) {
  authorizeAgency(ctx, "agency.billing.manage");
  assertSafeId(planId);
  const batch = getDb().batch();
  batch.delete(getDb().doc(`agencies/${ctx.agencyId}/planPrices/${planId}`));
  audit(
    batch,
    { agencyId: ctx.agencyId },
    {
      action: "billing.price_removed",
      actor: { type: "agency_staff", uid: ctx.uid },
      target: { type: "plan", id: planId },
      requestId: ctx.requestId,
    },
  );
  await batch.commit();
  return { ok: true as const };
}

export async function listPlanPrices(agencyId: string): Promise<PlanPrice[]> {
  const snap = await getDb().collection(`agencies/${agencyId}/planPrices`).get();
  return snap.docs
    .map((d) => d.data() as PlanPrice)
    .filter((p) => p.active)
    .sort((a, b) => a.amount - b.amount);
}

/** Agency console view of the gateway settings (no secrets, masked key). */
export async function getGatewaySettings(ctx: AgencyContext) {
  authorizeAgency(ctx, "agency.workspace.read");
  const billing = (await loadAgency(ctx.agencyId)).billing as AgencyBilling;
  return {
    mode: billing.mode,
    provider: billing.provider,
    env: billing.env,
    currency: billing.currency,
    keyIdHint: billing.keyIdHint ?? null,
    configured: Boolean(billing.secretRefs),
    prices: await listPlanPrices(ctx.agencyId),
  };
}

// ---------------------------------------------------------------- manual billing (FR-BILL-005)

export async function setManualBilling(
  ctx: AgencyContext,
  tenantId: string,
  input: { planId: string; paidUntil: string },
) {
  authorizeAgency(ctx, "agency.billing.manage");
  assertSafeId(tenantId);
  if (!(PLAN_IDS as string[]).includes(input.planId))
    throw new ValidationError({ planId: ["Unknown plan"] });
  const paidUntil = new Date(`${input.paidUntil}T23:59:59Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidUntil) || Number.isNaN(paidUntil.getTime())) {
    throw new ValidationError({ paidUntil: ["Enter a date"] });
  }
  const db = getDb();
  await db.runTransaction(async (tx) => {
    const tenantRef = db.doc(`tenants/${tenantId}`);
    const tenant = (await tx.get(tenantRef)).data() as TenantDoc | undefined;
    if (!tenant || tenant.agencyId !== ctx.agencyId) throw new NotFoundError();
    const subRef = db.doc(`tenants/${tenantId}/billing/subscription`);
    const sub: SubscriptionDoc = {
      ...((await tx.get(subRef)).data() as SubscriptionDoc | undefined),
      mode: "manual",
      provider: null,
      planId: input.planId,
      status: "manual",
      paidUntil: Timestamp.fromDate(paidUntil),
    };
    const state = deriveBillingState(sub, new Date(), tenant.billingState);
    tx.set(subRef, { ...sub, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.update(tenantRef, { planId: input.planId, billingState: state });
    audit(
      tx,
      { tenantId },
      {
        action: "billing.manual_set",
        actor: { type: "agency_staff", uid: ctx.uid },
        target: { type: "subscription", id: tenantId },
        meta: { planId: input.planId, paidUntil: input.paidUntil, billingState: state },
        requestId: ctx.requestId,
      },
    );
  });
  clearTenantCaches();
  return { ok: true as const };
}

// ---------------------------------------------------------------- workspace billing page

export interface BillingOverview {
  planId: string;
  billingState: BillingState;
  status: SubscriptionDoc["status"];
  mode: "gateway" | "manual" | "none";
  provider: PaymentProvider | null;
  currentPeriodEnd: string | null;
  paidUntil: string | null;
  cancelAtPeriodEnd: boolean;
  prices: Array<Pick<PlanPrice, "planId" | "amount" | "currency" | "interval">>;
  history: Array<{
    id: string;
    type: string;
    amount: number;
    currency: string;
    status: string;
    occurredAt: string;
  }>;
  canManage: boolean;
}

const iso = (ts: unknown) => (ts instanceof Timestamp ? ts.toDate().toISOString() : null);

/** FR-BILL-004: plan, status, next date and payment history. Amounts from our own records. */
export async function getBillingOverview(ctx: TenantContext): Promise<BillingOverview> {
  authorize(ctx, "billing.read");
  const db = getDb();
  const [subSnap, agency, history] = await Promise.all([
    db.doc(`tenants/${ctx.tenantId}/billing/subscription`).get(),
    loadAgency(ctx.agencyId),
    db
      .collection(`tenants/${ctx.tenantId}/billingHistory`)
      .orderBy("occurredAt", "desc")
      .limit(50)
      .get(),
  ]);
  const sub = (subSnap.data() ?? {
    provider: null,
    planId: "trial",
    status: "trialing",
  }) as SubscriptionDoc;
  const billing = agency.billing as AgencyBilling;
  const gatewayReady = billing.mode === "gateway" && Boolean(billing.secretRefs);
  return {
    planId: ctx.tenant.planId,
    billingState: ctx.tenant.billingState,
    status: sub.status,
    mode: sub.mode === "manual" ? "manual" : gatewayReady ? "gateway" : "none",
    provider: sub.provider,
    currentPeriodEnd: iso(sub.currentPeriodEnd),
    paidUntil: iso(sub.paidUntil),
    cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
    prices: gatewayReady
      ? (await listPlanPrices(ctx.agencyId)).map(({ planId, amount, currency, interval }) => ({
          planId,
          amount,
          currency,
          interval,
        }))
      : [],
    history: history.docs.map((d) => ({
      id: d.id,
      type: d.get("type") as string,
      amount: d.get("amount") as number,
      currency: d.get("currency") as string,
      status: d.get("status") as string,
      occurredAt: iso(d.get("occurredAt")) ?? "",
    })),
    canManage: ctx.role === "owner",
  };
}

const indexRef = (provider: string, key: string) =>
  getDb().doc(`subscriptionIndex/${provider}_${key.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 200)}`);

/** FR-BILL-002 AC1: start hosted checkout. Nothing changes until the gateway confirms. */
export async function startCheckout(ctx: TenantContext, planId: string): Promise<{ url: string }> {
  authorize(ctx, "billing.manage");
  const agency = await loadAgency(ctx.agencyId);
  const price = (
    await getDb().doc(`agencies/${ctx.agencyId}/planPrices/${planId}`).get()
  ).data() as PlanPrice | undefined;
  if (!price?.active) throw new ValidationError({ planId: ["This plan isn't available"] });
  const subRef = getDb().doc(`tenants/${ctx.tenantId}/billing/subscription`);
  const current = (await subRef.get()).data() as SubscriptionDoc | undefined;
  if (current?.subscriptionId && (current.status === "active" || current.status === "past_due")) {
    throw new ConflictError("subscription_exists");
  }
  const gateway = await agencyGateway(agency);
  const host = ctx.tenant.canonicalHost;
  const checkout = await gateway
    .createCheckout({
      planId: price.gatewayPlanId,
      reference: ctx.tenantId,
      returnUrl: hostUrl(host, "/settings/billing?checkout=done"),
      cancelUrl: hostUrl(host, "/settings/billing?checkout=cancelled"),
    })
    .catch(mapGatewayError);
  // Redirects only ever go to the provider's hosted page (the mock returns to this workspace).
  const target = new URL(checkout.url);
  const mock = getServerEnv().TEST_GATEWAY_MOCKS === "true";
  const allowed = mock
    ? target.host === new URL(hostUrl(host, "/")).host
    : target.protocol === "https:" && CHECKOUT_HOSTS[gateway.provider].test(target.host);
  if (!allowed) throw new AppError("INTERNAL", "checkout_host_not_allowed");

  const batch = getDb().batch();
  const mapping = { tenantId: ctx.tenantId, agencyId: ctx.agencyId, provider: gateway.provider };
  if (checkout.subscriptionId)
    batch.set(indexRef(gateway.provider, checkout.subscriptionId), mapping);
  if (checkout.sessionId)
    batch.set(indexRef(gateway.provider, `session_${checkout.sessionId}`), mapping);
  batch.set(
    subRef,
    {
      mode: "gateway",
      provider: gateway.provider,
      pendingSubscriptionId: checkout.subscriptionId ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  audit(
    batch,
    { tenantId: ctx.tenantId },
    {
      action: "billing.checkout_started",
      actor: { type: "user", uid: ctx.uid },
      target: { type: "plan", id: price.planId },
      meta: { provider: gateway.provider },
      requestId: ctx.requestId,
    },
  );
  await batch.commit();
  return { url: checkout.url };
}

/** FR-BILL-002 AC4: cancel at period end; the state follows the gateway. */
export async function cancelSubscription(ctx: TenantContext) {
  authorize(ctx, "billing.manage");
  const subRef = getDb().doc(`tenants/${ctx.tenantId}/billing/subscription`);
  const sub = (await subRef.get()).data() as SubscriptionDoc | undefined;
  if (!sub?.subscriptionId || !sub.provider) throw new ConflictError("no_subscription");
  const agency = await loadAgency(ctx.agencyId);
  const gateway = await agencyGateway(agency);
  await gateway.cancelSubscription(sub.subscriptionId, true).catch(mapGatewayError);
  await subRef.update({ cancelAtPeriodEnd: true, updatedAt: FieldValue.serverTimestamp() });
  await auditNow(
    { tenantId: ctx.tenantId },
    {
      action: "billing.cancel_requested",
      actor: { type: "user", uid: ctx.uid },
      target: { type: "subscription", id: sub.subscriptionId },
      requestId: ctx.requestId,
    },
  );
  const fresh = await gateway.fetchSubscription(sub.subscriptionId).catch(mapGatewayError);
  await applySubscription(ctx.tenantId, ctx.agencyId, gateway.provider, fresh, ctx.requestId);
  return { ok: true as const };
}

// ---------------------------------------------------------------- webhooks (FR-BILL-003)

const PAYMENT_EVENTS = new Set([
  "subscription.charged", // Razorpay
  "invoice.paid", // Stripe
  "PAYMENT.SALE.COMPLETED", // PayPal
  "payment", // mock
]);

export type WebhookOutcome = {
  status: 200 | 400 | 404;
  result: "stored" | "duplicate" | "ignored" | "invalid";
};

/**
 * Verify, store once, and (inline mode) apply. The agency in the URL only selects the secret; the
 * workspace comes from our own subscription index, and the state from the gateway API.
 */
export async function receiveWebhook(
  provider: string,
  agencyId: string,
  rawBody: string,
  headers: Headers,
  requestId: string,
): Promise<WebhookOutcome> {
  if (
    !(PAYMENT_PROVIDERS as readonly string[]).includes(provider) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(agencyId)
  ) {
    return { status: 404, result: "ignored" };
  }
  const agency = (await getDb().doc(`agencies/${agencyId}`).get()).data() as AgencyDoc | undefined;
  if (!agency || agency.billing.provider !== provider) return { status: 404, result: "ignored" };
  const gateway = await agencyGateway(agency);
  let event;
  try {
    event = await gateway.verifyWebhook(rawBody, headers);
  } catch {
    event = null;
  }
  if (!event) {
    logger.warn("payment.webhook_invalid_signature", { requestId, provider, agencyId });
    return { status: 400, result: "invalid" };
  }

  type Mapping = { tenantId: string; agencyId: string };
  let mapping: Mapping | undefined;
  if (event.subscriptionId) {
    mapping = (await indexRef(provider, event.subscriptionId).get()).data() as Mapping | undefined;
  }
  if (!mapping && event.checkoutSessionId) {
    mapping = (await indexRef(provider, `session_${event.checkoutSessionId}`).get()).data() as
      Mapping | undefined;
    if (mapping && event.subscriptionId) {
      await indexRef(provider, event.subscriptionId).set({
        tenantId: mapping.tenantId,
        agencyId: mapping.agencyId,
        provider,
      });
    }
  }
  const tenantId = mapping && mapping.agencyId === agencyId ? mapping.tenantId : null;

  const eventRef = getDb().doc(
    `paymentEvents/${provider}_${event.eventId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 200)}`,
  );
  try {
    await eventRef.create({
      provider,
      agencyId,
      tenantId,
      type: event.type.slice(0, 80),
      receivedAt: FieldValue.serverTimestamp(),
      processedAt: null,
      status: tenantId ? "received" : "ignored",
      summary: { subscriptionId: event.subscriptionId ?? null },
      expireAt: Timestamp.fromMillis(Date.now() + EVENT_TTL_MS),
    });
  } catch (error) {
    if ((error as { code?: number }).code === 6) return { status: 200, result: "duplicate" };
    throw error;
  }
  if (tenantId && jobsRunInline()) await applyPaymentEvent(eventRef.id, requestId);
  return { status: 200, result: tenantId ? "stored" : "ignored" };
}

/** Function trigger / inline: apply a stored event using the gateway's current state. */
export async function applyPaymentEvent(eventDocId: string, requestId = "payment-event") {
  const ref = getDb().doc(`paymentEvents/${eventDocId}`);
  const event = (await ref.get()).data();
  if (!event || event.status !== "received" || !event.tenantId) return;
  const provider = event.provider as PaymentProvider;
  try {
    const agency = await loadAgency(event.agencyId as string);
    const gateway = await agencyGateway(agency);
    const subscriptionId = (event.summary as { subscriptionId: string | null }).subscriptionId;
    if (!subscriptionId) {
      await ref.update({ status: "ignored", processedAt: FieldValue.serverTimestamp() });
      return;
    }
    const sub = await gateway.fetchSubscription(subscriptionId);
    await applySubscription(
      event.tenantId as string,
      event.agencyId as string,
      provider,
      sub,
      requestId,
      {
        paymentEventType: PAYMENT_EVENTS.has(event.type as string) ? (event.type as string) : null,
        eventId: eventDocId,
      },
    );
    await ref.update({
      status: "applied",
      processedAt: FieldValue.serverTimestamp(),
      "summary.status": sub.status,
    });
  } catch (error) {
    logger.error("payment.event_failed", { requestId, eventId: eventDocId, provider, error });
    await ref.update({ status: "failed", processedAt: FieldValue.serverTimestamp() });
  }
}

async function planIdFor(agencyId: string, gatewayPlanId: string | null): Promise<string | null> {
  if (!gatewayPlanId) return null;
  const snap = await getDb()
    .collection(`agencies/${agencyId}/planPrices`)
    .where("gatewayPlanId", "==", gatewayPlanId)
    .limit(1)
    .get();
  return (snap.docs[0]?.get("planId") as string | undefined) ?? null;
}

/** Writes the authoritative gateway state; billing state, plan, history, audit and notice in one transaction. */
export async function applySubscription(
  tenantId: string,
  agencyId: string,
  provider: PaymentProvider,
  remote: GatewaySubscription,
  requestId: string,
  opts: { paymentEventType?: string | null; eventId?: string } = {},
): Promise<{ changed: boolean; billingState: BillingState }> {
  const db = getDb();
  const mappedPlan = await planIdFor(agencyId, remote.planId);
  const result = await db.runTransaction(async (tx: Transaction) => {
    const tenantRef = db.doc(`tenants/${tenantId}`);
    const subRef = db.doc(`tenants/${tenantId}/billing/subscription`);
    const [tenantSnap, subSnap] = await Promise.all([tx.get(tenantRef), tx.get(subRef)]);
    const tenant = tenantSnap.data() as TenantDoc | undefined;
    if (!tenant || tenant.agencyId !== agencyId) throw new NotFoundError();
    const prev = (subSnap.data() ?? {
      provider,
      planId: tenant.planId,
      status: "trialing",
    }) as SubscriptionDoc;
    const now = new Date();
    const pastDueSince =
      remote.status === "past_due"
        ? prev.status === "past_due" && prev.pastDueSince
          ? prev.pastDueSince
          : Timestamp.fromDate(now)
        : null;
    const next: SubscriptionDoc = {
      ...prev,
      mode: "gateway",
      provider,
      planId: mappedPlan ?? prev.planId,
      status: remote.status,
      providerStatus: remote.providerStatus,
      subscriptionId: remote.id,
      pendingSubscriptionId:
        prev.pendingSubscriptionId === remote.id ? null : (prev.pendingSubscriptionId ?? null),
      currentPeriodEnd: remote.currentPeriodEnd
        ? Timestamp.fromDate(remote.currentPeriodEnd)
        : null,
      pastDueSince,
    };
    const billingState = deriveBillingState(next, now, tenant.billingState);
    const planId = remote.status === "active" && mappedPlan ? mappedPlan : tenant.planId;
    const changed = billingState !== tenant.billingState || planId !== tenant.planId;
    // Transactions: every read before the first write.
    const price =
      opts.paymentEventType && mappedPlan
        ? ((await tx.get(db.doc(`agencies/${agencyId}/planPrices/${mappedPlan}`))).data() as
            PlanPrice | undefined)
        : undefined;
    const owner =
      changed && tenant.ownerUid
        ? ((await tx.get(db.doc(`tenants/${tenantId}/members/${tenant.ownerUid}`))).data() as
            MemberDoc | undefined)
        : undefined;

    tx.set(subRef, { ...next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (changed) tx.update(tenantRef, { billingState, planId });
    if (opts.paymentEventType) {
      tx.set(db.doc(`tenants/${tenantId}/billingHistory/${opts.eventId ?? remote.id}`), {
        type: "payment",
        amount: price?.amount ?? 0,
        currency: price?.currency ?? "",
        status: "paid",
        occurredAt: FieldValue.serverTimestamp(),
        providerRef: remote.id,
      });
    }
    if (changed) {
      audit(
        tx,
        { tenantId },
        {
          action: "billing.state_changed",
          actor: { type: "system" },
          target: { type: "subscription", id: remote.id },
          meta: {
            from: tenant.billingState,
            to: billingState,
            planId,
            providerStatus: remote.providerStatus,
          },
          requestId,
        },
      );
      audit(
        tx,
        { agencyId },
        {
          action: "billing.state_changed",
          actor: { type: "system" },
          target: { type: "workspace", id: tenantId },
          meta: { from: tenant.billingState, to: billingState, planId },
          requestId,
        },
      );
      if (owner?.email) {
        queueMail(tx, {
          template: "billing_status_changed",
          to: owner.email,
          variables: {
            workspace: tenant.name,
            status: billingState.replace("_", " "),
            link: hostUrl(tenant.canonicalHost, "/settings/billing"),
          },
          tenantId,
        });
      }
    }
    return { changed, billingState };
  });
  if (result.changed) clearTenantCaches();
  return result;
}

// ---------------------------------------------------------------- reconciliation (FR-BILL-003 AC5)

export interface ReconcileReport {
  checked: number;
  drift: number;
  failed: number;
}

/** Nightly: re-fetch gateway subscriptions and re-derive time-based states (grace, manual expiry). */
export async function reconcileBilling(requestId = "reconcile"): Promise<ReconcileReport> {
  const db = getDb();
  const report: ReconcileReport = { checked: 0, drift: 0, failed: 0 };
  const tenants = await db
    .collection("tenants")
    .where("status", "in", ["active", "suspended"])
    .get();
  for (const t of tenants.docs) {
    const tenant = t.data() as TenantDoc;
    const sub = (await db.doc(`tenants/${t.id}/billing/subscription`).get()).data() as
      SubscriptionDoc | undefined;
    if (!sub) continue;
    report.checked++;
    try {
      if (sub.mode === "gateway" && sub.subscriptionId && sub.provider) {
        const gateway = await agencyGateway(await loadAgency(tenant.agencyId));
        const remote = await gateway.fetchSubscription(sub.subscriptionId);
        const drifted = remote.status !== sub.status;
        const { changed } = await applySubscription(
          t.id,
          tenant.agencyId,
          sub.provider,
          remote,
          requestId,
        );
        if (drifted || changed) {
          report.drift++;
          logger.warn("payment.reconciliation_drift", {
            requestId,
            tenantId: t.id,
            provider: sub.provider,
            changed,
          });
        }
      } else {
        const state = deriveBillingState(sub, new Date(), tenant.billingState);
        if (state !== tenant.billingState) {
          report.drift++;
          const batch = db.batch();
          batch.update(t.ref, { billingState: state });
          audit(
            batch,
            { tenantId: t.id },
            {
              action: "billing.state_changed",
              actor: { type: "system" },
              target: { type: "subscription", id: t.id },
              meta: { from: tenant.billingState, to: state, reason: "time" },
              requestId,
            },
          );
          await batch.commit();
        }
      }
    } catch (error) {
      report.failed++;
      logger.error("payment.reconciliation_failed", { requestId, tenantId: t.id, error });
    }
  }
  clearTenantCaches();
  return report;
}

export type { GatewayEnv };
