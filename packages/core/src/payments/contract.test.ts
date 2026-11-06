import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { PayPalGateway } from "./paypal";
import { RazorpayGateway } from "./razorpay";
import { StripeGateway } from "./stripe";
import type { GatewayCredentials, NormalizedStatus, PaymentGateway } from "./types";

// Shared gateway contract (TC-BILL-001): every adapter must behave the same against its provider's
// API. Here the APIs are fakes built from the documented shapes (verified 2026-11-05); the same
// suite runs against real sandboxes once keys exist (GATEWAY_SANDBOX=1, nightly).

const creds: GatewayCredentials = {
  keyId: "key_test_123",
  keySecret: "secret_test_456",
  webhookSecret: "whsec_test_789",
  env: "test",
};

type Call = { method: string; url: string; body: string | null; headers: Headers };
type Route = (call: Call) => { status?: number; json?: unknown } | undefined;

function fakeFetch(route: Route) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    const call = {
      method: init.method ?? "GET",
      url,
      body: (init.body as string | undefined) ?? null,
      headers: new Headers(init.headers),
    };
    calls.push(call);
    const res = route(call) ?? { status: 404, json: { error: { code: "not_found" } } };
    if (res.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(res.json ?? {}), { status: res.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

interface Provider {
  name: string;
  make: (fetcher: typeof fetch) => PaymentGateway;
  route: (state: Record<string, string>) => Route;
  planId: string;
  /** Provider status strings and what they must normalize to. */
  statuses: Array<[string, NormalizedStatus]>;
  signedWebhook: (body: string) => Headers;
  webhookBody: string;
}

const hex = (secret: string, msg: string) => createHmac("sha256", secret).update(msg).digest("hex");

const razorpay: Provider = {
  name: "razorpay",
  make: (f) => new RazorpayGateway(creds, f),
  planId: "plan_ABCDEFGHIJKLMN",
  statuses: [
    ["created", "pending"],
    ["authenticated", "pending"],
    ["active", "active"],
    ["pending", "past_due"],
    ["halted", "unpaid"],
    ["cancelled", "cancelled"],
    ["completed", "cancelled"],
    ["expired", "cancelled"],
  ],
  route: (state) => (c) => {
    if (c.method === "GET" && c.url.endsWith("/v1/plans/plan_ABCDEFGHIJKLMN"))
      return {
        json: {
          id: "plan_ABCDEFGHIJKLMN",
          period: "monthly",
          interval: 1,
          item: { amount: 49900, currency: "INR" },
        },
      };
    if (c.method === "POST" && c.url.endsWith("/v1/subscriptions"))
      return { json: { id: "sub_1", status: "created", short_url: "https://rzp.io/i/abc" } };
    if (c.method === "GET" && c.url.endsWith("/v1/subscriptions/sub_1"))
      return {
        json: {
          id: "sub_1",
          status: state.status,
          plan_id: "plan_ABCDEFGHIJKLMN",
          current_end: 1_800_000_000,
        },
      };
    if (c.method === "POST" && c.url.endsWith("/v1/subscriptions/sub_1/cancel"))
      return { json: { id: "sub_1" } };
    return undefined;
  },
  webhookBody: JSON.stringify({
    event: "subscription.charged",
    payload: { subscription: { entity: { id: "sub_1" } } },
  }),
  signedWebhook: (body) =>
    new Headers({
      "x-razorpay-signature": hex(creds.webhookSecret, body),
      "x-razorpay-event-id": "evt_1",
    }),
};

const stripe: Provider = {
  name: "stripe",
  make: (f) => new StripeGateway(creds, f),
  planId: "price_123",
  statuses: [
    ["incomplete", "pending"],
    ["trialing", "active"],
    ["active", "active"],
    ["past_due", "past_due"],
    ["unpaid", "unpaid"],
    ["paused", "unpaid"],
    ["canceled", "cancelled"],
    ["incomplete_expired", "cancelled"],
  ],
  route: (state) => (c) => {
    if (c.method === "GET" && c.url.endsWith("/v1/prices/price_123"))
      return {
        json: {
          id: "price_123",
          unit_amount: 2900,
          currency: "usd",
          recurring: { interval: "month", interval_count: 1 },
        },
      };
    if (c.method === "POST" && c.url.endsWith("/v1/checkout/sessions"))
      return { json: { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" } };
    if (c.method === "GET" && c.url.endsWith("/v1/subscriptions/sub_1"))
      return {
        json: {
          id: "sub_1",
          status: state.status,
          items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_123" } }] },
        },
      };
    if (c.url.endsWith("/v1/subscriptions/sub_1")) return { json: { id: "sub_1" } };
    return undefined;
  },
  webhookBody: JSON.stringify({
    id: "evt_1",
    type: "invoice.paid",
    data: { object: { object: "invoice", subscription: "sub_1" } },
  }),
  signedWebhook: (body) => {
    const t = Math.floor(Date.now() / 1000);
    return new Headers({
      "stripe-signature": `t=${t},v1=${hex(creds.webhookSecret, `${t}.${body}`)}`,
    });
  },
};

const paypalHeaders = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  "paypal-transmission-id": "t-1",
  "paypal-transmission-sig": "sig",
  "paypal-transmission-time": new Date().toISOString(),
};
const paypal: Provider = {
  name: "paypal",
  make: (f) => new PayPalGateway(creds, f),
  planId: "P-123",
  statuses: [
    ["APPROVAL_PENDING", "pending"],
    ["APPROVED", "pending"],
    ["ACTIVE", "active"],
    ["SUSPENDED", "past_due"],
    ["CANCELLED", "cancelled"],
    ["EXPIRED", "cancelled"],
  ],
  route: (state) => (c) => {
    if (c.url.endsWith("/v1/oauth2/token"))
      return { json: { access_token: "tok", expires_in: 3600 } };
    if (c.method === "GET" && c.url.endsWith("/v1/billing/plans/P-123"))
      return {
        json: {
          id: "P-123",
          billing_cycles: [
            {
              tenure_type: "REGULAR",
              frequency: { interval_unit: "MONTH", interval_count: 1 },
              pricing_scheme: { fixed_price: { value: "19.00", currency_code: "USD" } },
            },
          ],
        },
      };
    if (c.method === "POST" && c.url.endsWith("/v1/billing/subscriptions"))
      return {
        status: 201,
        json: {
          id: "sub_1",
          links: [
            {
              rel: "approve",
              href: "https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=1",
            },
          ],
        },
      };
    if (c.method === "GET" && c.url.endsWith("/v1/billing/subscriptions/sub_1"))
      return {
        json: {
          id: "sub_1",
          status: state.status,
          plan_id: "P-123",
          billing_info: { next_billing_time: "2027-01-15T10:00:00Z" },
        },
      };
    if (c.url.endsWith("/v1/billing/subscriptions/sub_1/cancel")) {
      if (!c.body?.includes('"reason"')) return { status: 422, json: { name: "MISSING_REASON" } };
      return { status: 204 };
    }
    if (c.url.endsWith("/v1/notifications/verify-webhook-signature")) {
      const body = JSON.parse(c.body ?? "{}") as { webhook_id: string; transmission_sig: string };
      const ok = body.webhook_id === creds.webhookSecret && body.transmission_sig === "sig";
      return { json: { verification_status: ok ? "SUCCESS" : "FAILURE" } };
    }
    return undefined;
  },
  webhookBody: JSON.stringify({
    id: "WH-1",
    event_type: "PAYMENT.SALE.COMPLETED",
    resource: { id: "sale_1", billing_agreement_id: "sub_1" },
  }),
  signedWebhook: () => new Headers(paypalHeaders),
};

describe.each([razorpay, stripe, paypal])("$name gateway contract (TC-BILL-001)", (p) => {
  const setup = (status = "active") => {
    const state = { status };
    const { fetcher, calls } = fakeFetch(p.route(state));
    return { gateway: p.make(fetcher), calls, state };
  };

  it("fetches a plan as minor units, currency and interval", async () => {
    const plan = await setup().gateway.fetchPlan(p.planId);
    expect(plan.id).toBe(p.planId);
    expect(Number.isInteger(plan.amountMinor) && plan.amountMinor > 0).toBe(true);
    expect(plan.currency).toMatch(/^[A-Z]{3}$/);
    expect(plan.interval).toBe("month");
  });

  it("creates a hosted checkout on the provider's own https domain", async () => {
    const result = await setup().gateway.createCheckout({
      planId: p.planId,
      reference: "tnt_1",
      returnUrl: "https://crm.acme.test/settings/billing?checkout=done",
      cancelUrl: "https://crm.acme.test/settings/billing?checkout=cancelled",
    });
    const url = new URL(result.url);
    expect(url.protocol).toBe("https:");
    expect(url.host).not.toContain("acme");
    expect(result.subscriptionId ?? result.sessionId).toBeTruthy();
  });

  it("normalizes every documented subscription status", async () => {
    for (const [providerStatus, normalized] of p.statuses) {
      const sub = await setup(providerStatus).gateway.fetchSubscription("sub_1");
      expect(sub, providerStatus).toMatchObject({
        id: "sub_1",
        status: normalized,
        providerStatus,
      });
      expect(sub.currentPeriodEnd).toBeInstanceOf(Date);
      expect(sub.planId).toBe(p.planId);
    }
  });

  it("cancels a subscription", async () => {
    const { gateway, calls } = setup();
    await gateway.cancelSubscription("sub_1", true);
    expect(calls.some((c) => c.url.includes("sub_1") && c.method !== "GET")).toBe(true);
  });

  it("accepts a correctly signed webhook and maps it to the subscription", async () => {
    const event = await setup().gateway.verifyWebhook(
      p.webhookBody,
      p.signedWebhook(p.webhookBody),
    );
    expect(event).toMatchObject({ subscriptionId: "sub_1" });
    expect(event!.eventId).toBeTruthy();
  });

  it("rejects tampered bodies and missing signatures (TC-BILL-003)", async () => {
    const { gateway } = setup();
    const tampered = p.webhookBody.replace("sub_1", "sub_2");
    if (p.name !== "paypal") {
      expect(await gateway.verifyWebhook(tampered, p.signedWebhook(p.webhookBody))).toBeNull();
    }
    expect(await gateway.verifyWebhook(p.webhookBody, new Headers())).toBeNull();
  });

  it("reports gateway errors without provider payloads", async () => {
    const { fetcher } = fakeFetch(() => ({
      status: 401,
      json: { error: { code: "BAD_REQUEST_ERROR", description: "Customer raj@acme.test" } },
    }));
    const error = await p
      .make(fetcher)
      .fetchSubscription("sub_9")
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain("raj@acme.test");
  });
});

describe("provider-specific signature rules", () => {
  it("Stripe refuses signatures outside the 5-minute tolerance", async () => {
    const old = Math.floor(Date.now() / 1000) - 600;
    const body = stripe.webhookBody;
    const headers = new Headers({
      "stripe-signature": `t=${old},v1=${hex(creds.webhookSecret, `${old}.${body}`)}`,
    });
    expect(
      await stripe.make(fakeFetch(() => undefined).fetcher).verifyWebhook(body, headers),
    ).toBeNull();
  });

  it("Razorpay requires the event-id header for idempotency", async () => {
    const body = razorpay.webhookBody;
    const headers = new Headers({ "x-razorpay-signature": hex(creds.webhookSecret, body) });
    expect(
      await razorpay.make(fakeFetch(() => undefined).fetcher).verifyWebhook(body, headers),
    ).toBeNull();
  });

  it("PayPal rejects events PayPal doesn't verify", async () => {
    const { fetcher } = fakeFetch(paypal.route({ status: "ACTIVE" }));
    const headers = new Headers({ ...paypalHeaders, "paypal-transmission-sig": "forged" });
    expect(await paypal.make(fetcher).verifyWebhook(paypal.webhookBody, headers)).toBeNull();
  });

  it("PayPal cancel sends the required reason", async () => {
    const { fetcher, calls } = fakeFetch(paypal.route({ status: "ACTIVE" }));
    await paypal.make(fetcher).cancelSubscription("sub_1", true);
    expect(calls.at(-1)!.body).toContain("reason");
  });
});
