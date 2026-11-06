import "server-only";
import { parseMoney } from "@crm/shared/records/money";
import { basic, callGateway, type Fetch } from "./http";
import {
  GatewayError,
  type CheckoutRequest,
  type CheckoutResult,
  type GatewayCredentials,
  type GatewayPlan,
  type GatewaySubscription,
  type NormalizedStatus,
  type PaymentGateway,
  type WebhookEvent,
} from "./types";

// PayPal Subscriptions (verified 2026-11-05): plan price under billing_cycles[].pricing_scheme;
// cancel needs a `reason` (204); webhooks are verified by PayPal's
// /v1/notifications/verify-webhook-signature API with the agency's webhook ID. The approval link rel
// ("approve", or "payer-action") couldn't be confirmed from the docs — both are accepted.

const BASE = { test: "https://api-m.sandbox.paypal.com", live: "https://api-m.paypal.com" };

const STATUS: Record<string, NormalizedStatus> = {
  APPROVAL_PENDING: "pending",
  APPROVED: "pending",
  ACTIVE: "active",
  SUSPENDED: "past_due",
  CANCELLED: "cancelled",
  EXPIRED: "cancelled",
};

type Link = { href: string; rel: string };

export class PayPalGateway implements PaymentGateway {
  readonly provider = "paypal" as const;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly creds: GatewayCredentials,
    private readonly fetcher: Fetch = fetch,
  ) {}

  private get base() {
    return BASE[this.creds.env];
  }

  private async bearer(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await callGateway<{ access_token: string; expires_in: number }>(
      this.fetcher,
      this.provider,
      `${this.base}/v1/oauth2/token`,
      {
        auth: basic(this.creds.keyId, this.creds.keySecret),
        form: { grant_type: "client_credentials" },
      },
    );
    this.token = { value: res.access_token, expiresAt: Date.now() + res.expires_in * 1000 };
    return res.access_token;
  }

  private async call<T>(path: string, opts: { method?: "GET" | "POST"; json?: unknown } = {}) {
    return callGateway<T>(this.fetcher, this.provider, `${this.base}${path}`, {
      auth: `Bearer ${await this.bearer()}`,
      ...opts,
    });
  }

  async fetchPlan(planId: string): Promise<GatewayPlan> {
    const plan = await this.call<{
      id: string;
      billing_cycles?: Array<{
        tenure_type: string;
        frequency: { interval_unit: string; interval_count?: number };
        pricing_scheme?: { fixed_price?: { value: string; currency_code: string } };
      }>;
    }>(`/v1/billing/plans/${encodeURIComponent(planId)}`);
    const cycle = plan.billing_cycles?.find((c) => c.tenure_type === "REGULAR");
    const price = cycle?.pricing_scheme?.fixed_price;
    const unit = cycle?.frequency.interval_unit;
    const interval =
      (cycle?.frequency.interval_count ?? 1) === 1 && (unit === "MONTH" || unit === "YEAR")
        ? (unit.toLowerCase() as "month" | "year")
        : null;
    const amountMinor = price ? parseMoney(price.value, price.currency_code) : null;
    if (!price || !interval || amountMinor === null) {
      throw new GatewayError(this.provider, 422, "unsupported_plan");
    }
    return { id: plan.id, amountMinor, currency: price.currency_code.toUpperCase(), interval };
  }

  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    const sub = await this.call<{ id: string; links?: Link[] }>("/v1/billing/subscriptions", {
      json: {
        plan_id: input.planId,
        custom_id: input.reference,
        application_context: {
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
          user_action: "SUBSCRIBE_NOW",
          shipping_preference: "NO_SHIPPING",
        },
      },
    });
    const link = sub.links?.find((l) => l.rel === "approve" || l.rel === "payer-action");
    if (!link) throw new GatewayError(this.provider, 502, "no_approval_link");
    return { subscriptionId: sub.id, url: link.href };
  }

  async fetchSubscription(id: string): Promise<GatewaySubscription> {
    const sub = await this.call<{
      id: string;
      status: string;
      plan_id?: string;
      billing_info?: { next_billing_time?: string };
    }>(`/v1/billing/subscriptions/${encodeURIComponent(id)}`);
    const next = sub.billing_info?.next_billing_time;
    return {
      id: sub.id,
      status: STATUS[sub.status] ?? "unpaid",
      providerStatus: sub.status,
      planId: sub.plan_id ?? null,
      currentPeriodEnd: next ? new Date(next) : null,
    };
  }

  /** PayPal cancels immediately; the paid period is honoured on our side (currentPeriodEnd). */
  async cancelSubscription(id: string): Promise<void> {
    await this.call(`/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, {
      json: { reason: "Cancelled by the workspace owner" },
    });
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent | null> {
    const h = (name: string) => headers.get(name) ?? "";
    const fields = {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
    };
    if (Object.values(fields).some((v) => !v)) return null;
    const event = JSON.parse(rawBody) as {
      id?: string;
      event_type?: string;
      resource_type?: string;
      resource?: { id?: string; billing_agreement_id?: string };
    };
    const result = await this.call<{ verification_status: string }>(
      "/v1/notifications/verify-webhook-signature",
      { json: { ...fields, webhook_id: this.creds.webhookSecret, webhook_event: event } },
    );
    if (result.verification_status !== "SUCCESS" || !event.id) return null;
    const isSubscription =
      event.resource_type === "subscription" ||
      event.event_type?.startsWith("BILLING.SUBSCRIPTION");
    return {
      eventId: event.id,
      type: String(event.event_type ?? "unknown"),
      subscriptionId: isSubscription
        ? (event.resource?.id ?? null)
        : (event.resource?.billing_agreement_id ?? null),
    };
  }
}
