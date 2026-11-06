// Payment gateway abstraction (FR-BILL-001, ADR-021). Adapters translate each provider's API into
// these shapes. Card/bank data never reaches us: checkout always happens on the provider's hosted page.

export const PAYMENT_PROVIDERS = ["razorpay", "stripe", "paypal"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];
export type GatewayEnv = "test" | "live";

/** Per-agency credentials, loaded from the secret store (never from Firestore). */
export interface GatewayCredentials {
  /** Razorpay key_id · Stripe secret key · PayPal client ID. */
  keyId: string;
  /** Razorpay key_secret · (unused for Stripe) · PayPal client secret. */
  keySecret: string;
  /** Razorpay webhook secret · Stripe `whsec_…` · PayPal webhook ID (verification is an API call). */
  webhookSecret: string;
  env: GatewayEnv;
}

export interface GatewayPlan {
  id: string;
  amountMinor: number;
  currency: string;
  interval: "month" | "year";
}

/** Normalized subscription state; `pending` = created but not yet authorized by the customer. */
export type NormalizedStatus = "pending" | "active" | "past_due" | "unpaid" | "cancelled";

export interface GatewaySubscription {
  id: string;
  status: NormalizedStatus;
  /** Provider's own status string, kept for support/debugging. */
  providerStatus: string;
  planId: string | null;
  currentPeriodEnd: Date | null;
}

export interface CheckoutRequest {
  planId: string;
  /** Our reference (tenant ID); stored by the provider for support, never trusted on the way back. */
  reference: string;
  returnUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  subscriptionId: string | null;
  /** Hosted page on the provider's domain. */
  url: string;
  /** Stripe creates the subscription only after checkout; the session ID maps it back. */
  sessionId?: string;
}

export interface WebhookEvent {
  eventId: string;
  type: string;
  subscriptionId: string | null;
  /** Stripe checkout sessions: links a session to the subscription it created. */
  checkoutSessionId?: string | null;
}

export interface PaymentGateway {
  provider: PaymentProvider;
  fetchPlan(planId: string): Promise<GatewayPlan>;
  createCheckout(input: CheckoutRequest): Promise<CheckoutResult>;
  fetchSubscription(id: string): Promise<GatewaySubscription>;
  cancelSubscription(id: string, atPeriodEnd: boolean): Promise<void>;
  /** Verifies the signature over the RAW body; returns null when it doesn't verify. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent | null>;
}

export class GatewayError extends Error {
  constructor(
    readonly provider: PaymentProvider,
    readonly status: number,
    code: string,
  ) {
    super(`${provider}_${code}`);
  }
}

/** Hosts a checkout redirect may point to — anything else is refused (open-redirect guard). */
export const CHECKOUT_HOSTS: Record<PaymentProvider, RegExp> = {
  razorpay: /^(rzp\.io|([a-z0-9-]+\.)*razorpay\.com)$/,
  stripe: /^checkout\.stripe\.com$/,
  paypal: /^www\.(sandbox\.)?paypal\.com$/,
};
