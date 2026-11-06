import "server-only";
import { randomBytes } from "node:crypto";
import { getDb } from "../firebase-admin";
import { getServerEnv } from "../server-env";
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
  type PaymentProvider,
  type WebhookEvent,
} from "./types";

// Deterministic gateway for local runs and E2E (TEST_GATEWAY_MOCKS, rejected in hosted envs). State
// lives in the Firestore EMULATOR so the test runner and the app server see the same subscriptions.
// Plan IDs encode their price: "plan_<amountMinor>_<CURRENCY>_<month|year>".
// Webhooks: header "x-mock-signature" = hex HMAC-SHA256(rawBody, webhook secret).

const PLAN = /^plan_(\d{1,9})_([A-Z]{3})_(month|year)$/;

function assertEmulator() {
  if (!getServerEnv().FIRESTORE_EMULATOR_HOST)
    throw new Error("mock gateway requires the emulator");
}

const subs = () => getDb().collection("_mockGateway");

export class MockGateway implements PaymentGateway {
  constructor(
    readonly provider: PaymentProvider,
    private readonly creds: GatewayCredentials,
  ) {
    assertEmulator();
  }

  async fetchPlan(planId: string): Promise<GatewayPlan> {
    const m = PLAN.exec(planId);
    if (!m) throw new GatewayError(this.provider, 404, "plan_not_found");
    return {
      id: planId,
      amountMinor: Number(m[1]),
      currency: m[2]!,
      interval: m[3] as "month" | "year",
    };
  }

  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    await this.fetchPlan(input.planId);
    const id = `sub_mock_${randomBytes(8).toString("hex")}`;
    await subs().doc(id).set({ status: "pending", planId: input.planId, currentPeriodEnd: null });
    const url = new URL(input.returnUrl);
    url.searchParams.set("mock_subscription", id);
    return { subscriptionId: id, url: url.toString() };
  }

  async fetchSubscription(id: string): Promise<GatewaySubscription> {
    const data = (await subs().doc(id).get()).data();
    if (!data) throw new GatewayError(this.provider, 404, "subscription_not_found");
    return {
      id,
      status: data.status as NormalizedStatus,
      providerStatus: data.status as string,
      planId: data.planId as string,
      currentPeriodEnd: data.currentPeriodEnd ? new Date(data.currentPeriodEnd as number) : null,
    };
  }

  async cancelSubscription(id: string): Promise<void> {
    await subs().doc(id).update({ status: "cancelled" });
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent | null> {
    const signature = headers.get("x-mock-signature") ?? "";
    if (!signature || !safeEqualHex(signature, hmacHex(this.creds.webhookSecret, rawBody)))
      return null;
    const body = JSON.parse(rawBody) as { id?: string; type?: string; subscriptionId?: string };
    if (!body.id) return null;
    return {
      eventId: body.id,
      type: body.type ?? "unknown",
      subscriptionId: body.subscriptionId ?? null,
    };
  }
}

/** Test/E2E helper: change a mock subscription as the provider would. */
export async function setMockSubscription(
  id: string,
  patch: { status?: NormalizedStatus; currentPeriodEnd?: Date | null },
) {
  assertEmulator();
  await subs()
    .doc(id)
    .update({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.currentPeriodEnd !== undefined
        ? { currentPeriodEnd: patch.currentPeriodEnd?.getTime() ?? null }
        : {}),
    });
}

/** Test/E2E helper: a correctly signed mock webhook body + headers. */
export function signMockWebhook(
  webhookSecret: string,
  event: { id: string; type: string; subscriptionId: string },
) {
  const body = JSON.stringify(event);
  return {
    body,
    headers: {
      "x-mock-signature": hmacHex(webhookSecret, body),
      "content-type": "application/json",
    },
  };
}
