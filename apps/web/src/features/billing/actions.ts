"use server";

import { z } from "zod";
import { cancelSubscription, startCheckout } from "@crm/core/payments";
import { actions } from "@/server/actions";

// Workspace billing (FR-BILL-002). Owner only (billing.manage) with a recent sign-in; nothing about
// the plan changes here — only the gateway's confirmed state does (webhook / reconciliation).

export const startCheckoutAction = actions.tenant({
  name: "billing.startCheckout",
  permission: "billing.manage",
  reauth: true,
  schema: z.object({ planId: z.enum(["starter", "growth", "enterprise"]) }),
  handler: (ctx, input) => startCheckout(ctx, input.planId),
});

export const cancelSubscriptionAction = actions.tenant({
  name: "billing.cancel",
  permission: "billing.manage",
  reauth: true,
  schema: z.object({}),
  handler: (ctx) => cancelSubscription(ctx),
});
