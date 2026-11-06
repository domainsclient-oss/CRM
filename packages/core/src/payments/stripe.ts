import "server-only";
import { callGateway, type Fetch } from "./http";
import { hmacHex, safeEqualHex } from "./razorpay";
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

// Stripe Billing via Checkout (verified 2026-11-05): Stripe-Signature "t=…,v1=…", HMAC-SHA256 of
// `${t}.${rawBody}` with the endpoint secret, 5-minute tolerance; current period end lives on the
// subscription items in current API versions.

const API = "https://api.stripe.com/v1";
export const STRIPE_TOLERANCE_SECONDS = 300;

const STATUS: Record<string, NormalizedStatus> = {
  incomplete: "pending",
  trialing: "active",
  active: "active",
  past_due: "past_due",
  unpaid: "unpaid",
  paused: "unpaid",
  canceled: "cancelled",
  incomplete_expired: "cancelled",
};

export class StripeGateway implements PaymentGateway {
  readonly provider = "stripe" as const;

  constructor(
    private readonly creds: GatewayCredentials,
    private readonly fetcher: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private call<T>(
    path: string,
    opts: { method?: "GET" | "POST" | "DELETE"; form?: Record<string, string> } = {},
  ) {
    return callGateway<T>(this.fetcher, this.provider, `${API}${path}`, {
      auth: `Bearer ${this.creds.keyId}`,
      ...opts,
    });
  }

  async fetchPlan(priceId: string): Promise<GatewayPlan> {
    const price = await this.call<{
      id: string;
      unit_amount: number | null;
      currency: string;
      recurring: { interval: string; interval_count: number } | null;
    }>(`/prices/${encodeURIComponent(priceId)}`);
    const r = price.recurring;
    const interval =
      r && r.interval_count === 1 && (r.interval === "month" || r.interval === "year")
        ? r.interval
        : null;
    if (!interval || price.unit_amount === null) {
      throw new GatewayError(this.provider, 422, "unsupported_price");
    }
    return {
      id: price.id,
      amountMinor: price.unit_amount,
      currency: price.currency.toUpperCase(),
      interval,
    };
  }

  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    const session = await this.call<{ id: string; url: string }>("/checkout/sessions", {
      form: {
        mode: "subscription",
        "line_items[0][price]": input.planId,
        "line_items[0][quantity]": "1",
        success_url: input.returnUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.reference,
      },
    });
    return { subscriptionId: null, sessionId: session.id, url: session.url };
  }

  async fetchSubscription(id: string): Promise<GatewaySubscription> {
    const sub = await this.call<{
      id: string;
      status: string;
      current_period_end?: number;
      items?: { data?: Array<{ current_period_end?: number; price?: { id?: string } }> };
    }>(`/subscriptions/${encodeURIComponent(id)}`);
    const item = sub.items?.data?.[0];
    const end = item?.current_period_end ?? sub.current_period_end ?? null;
    return {
      id: sub.id,
      status: STATUS[sub.status] ?? "unpaid",
      providerStatus: sub.status,
      planId: item?.price?.id ?? null,
      currentPeriodEnd: end ? new Date(end * 1000) : null,
    };
  }

  async cancelSubscription(id: string, atPeriodEnd: boolean): Promise<void> {
    const path = `/subscriptions/${encodeURIComponent(id)}`;
    if (atPeriodEnd) await this.call(path, { form: { cancel_at_period_end: "true" } });
    else await this.call(path, { method: "DELETE" });
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent | null> {
    const header = headers.get("stripe-signature") ?? "";
    let timestamp = "";
    const signatures: string[] = [];
    for (const part of header.split(",")) {
      const [k, v] = part.trim().split("=");
      if (k === "t" && v) timestamp = v;
      if (k === "v1" && v) signatures.push(v);
    }
    const t = Number(timestamp);
    if (!Number.isFinite(t) || signatures.length === 0) return null;
    if (Math.abs(this.now() / 1000 - t) > STRIPE_TOLERANCE_SECONDS) return null;
    const expected = hmacHex(this.creds.webhookSecret, `${timestamp}.${rawBody}`);
    if (!signatures.some((s) => safeEqualHex(s, expected))) return null;
    const event = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      data?: { object?: Record<string, unknown> };
    };
    const obj = event.data?.object ?? {};
    let subscriptionId: string | null = null;
    let checkoutSessionId: string | null = null;
    if (obj.object === "subscription") subscriptionId = String(obj.id);
    else if (obj.object === "checkout.session") {
      checkoutSessionId = String(obj.id);
      subscriptionId = typeof obj.subscription === "string" ? obj.subscription : null;
    } else if (obj.object === "invoice") {
      const nested = (
        obj.parent as { subscription_details?: { subscription?: string } } | undefined
      )?.subscription_details?.subscription;
      subscriptionId = typeof obj.subscription === "string" ? obj.subscription : (nested ?? null);
    }
    if (!event.id) return null;
    return {
      eventId: event.id,
      type: String(event.type ?? "unknown"),
      subscriptionId,
      checkoutSessionId,
    };
  }
}
