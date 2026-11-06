import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
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

// Razorpay Subscriptions (verified 2026-11-05): webhook X-Razorpay-Signature = hex HMAC-SHA256 of the
// raw body with the webhook secret; x-razorpay-event-id for idempotency; hosted link = short_url.

const API = "https://api.razorpay.com/v1";
/** Razorpay requires a total cycle count; 10 years of monthly (or yearly) cycles. */
const TOTAL_COUNT = 120;

const STATUS: Record<string, NormalizedStatus> = {
  created: "pending",
  authenticated: "pending",
  active: "active",
  pending: "past_due",
  halted: "unpaid",
  paused: "unpaid",
  cancelled: "cancelled",
  completed: "cancelled",
  expired: "cancelled",
};

export function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export class RazorpayGateway implements PaymentGateway {
  readonly provider = "razorpay" as const;
  private readonly auth: string;

  constructor(
    private readonly creds: GatewayCredentials,
    private readonly fetcher: Fetch = fetch,
  ) {
    this.auth = basic(creds.keyId, creds.keySecret);
  }

  private call<T>(path: string, opts: { method?: "GET" | "POST"; json?: unknown } = {}) {
    return callGateway<T>(this.fetcher, this.provider, `${API}${path}`, {
      auth: this.auth,
      ...opts,
    });
  }

  async fetchPlan(planId: string): Promise<GatewayPlan> {
    const plan = await this.call<{
      id: string;
      period: string;
      interval: number;
      item: { amount: number; currency: string };
    }>(`/plans/${encodeURIComponent(planId)}`);
    const interval =
      plan.period === "monthly" && plan.interval === 1
        ? "month"
        : (plan.period === "yearly" && plan.interval === 1) ||
            (plan.period === "monthly" && plan.interval === 12)
          ? "year"
          : null;
    if (!interval) throw new GatewayError(this.provider, 422, "unsupported_interval");
    return {
      id: plan.id,
      amountMinor: plan.item.amount,
      currency: plan.item.currency.toUpperCase(),
      interval,
    };
  }

  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    const sub = await this.call<{ id: string; short_url: string }>("/subscriptions", {
      json: {
        plan_id: input.planId,
        total_count: TOTAL_COUNT,
        customer_notify: true,
        notes: { reference: input.reference },
      },
    });
    return { subscriptionId: sub.id, url: sub.short_url };
  }

  async fetchSubscription(id: string): Promise<GatewaySubscription> {
    const sub = await this.call<{
      id: string;
      status: string;
      plan_id: string;
      current_end: number | null;
    }>(`/subscriptions/${encodeURIComponent(id)}`);
    return {
      id: sub.id,
      status: STATUS[sub.status] ?? "unpaid",
      providerStatus: sub.status,
      planId: sub.plan_id ?? null,
      currentPeriodEnd: sub.current_end ? new Date(sub.current_end * 1000) : null,
    };
  }

  async cancelSubscription(id: string, atPeriodEnd: boolean): Promise<void> {
    await this.call(`/subscriptions/${encodeURIComponent(id)}/cancel`, {
      json: { cancel_at_cycle_end: atPeriodEnd },
    });
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent | null> {
    const signature = headers.get("x-razorpay-signature") ?? "";
    const eventId = headers.get("x-razorpay-event-id") ?? "";
    if (!signature || !eventId) return null;
    if (!safeEqualHex(signature, hmacHex(this.creds.webhookSecret, rawBody))) return null;
    const body = JSON.parse(rawBody) as {
      event?: string;
      payload?: { subscription?: { entity?: { id?: string } } };
    };
    return {
      eventId,
      type: String(body.event ?? "unknown"),
      subscriptionId: body.payload?.subscription?.entity?.id ?? null,
    };
  }
}
