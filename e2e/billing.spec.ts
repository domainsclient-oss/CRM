import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  emulatorEnabled,
  resetEmulators,
  seedMember,
  seedMockGateway,
  seedWorkspace,
  setMockGatewaySubscription,
} from "./support/emulator";
import { failOnCspViolations } from "./support/csp";

// UC-10 / TC-BILL-002/003 end to end with the mock gateway: subscribe from the billing page, the
// gateway confirms by signed webhook, the plan activates; a forged webhook changes nothing.
test.skip(!emulatorEnabled(), "requires emulators (pnpm test:e2e:auth)");
test.describe.configure({ mode: "serial" });
failOnCspViolations(test);

const PORT = process.env.E2E_PORT ?? "3100";
const HOST = `bill.app.localhost:${PORT}`;
const url = (path: string) => `http://${HOST}${path}`;
const PASSWORD = "correct horse battery staple";
const SECRET = "whsec_e2e_mock_secret";
let agencyId = "";

test.beforeAll(async () => {
  await resetEmulators();
  const ws = await seedWorkspace("bill", HOST, "Billing Co");
  agencyId = ws.agencyId;
  await seedMember(ws.tenantId, "owner@bill.test", PASSWORD, "owner");
  await seedMember(ws.tenantId, "admin@bill.test", PASSWORD, "admin");
  await seedMockGateway(agencyId, SECRET, "plan_249900_USD_month");
});

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto(url("/login"));
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to/ })).toBeVisible();
}

function webhook(subscriptionId: string, eventId: string, secret = SECRET) {
  const body = JSON.stringify({ id: eventId, type: "payment", subscriptionId });
  return {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-mock-signature": createHmac("sha256", secret).update(body).digest("hex"),
    },
  };
}

test("owner subscribes via hosted checkout; only the confirmed webhook activates the plan", async ({
  page,
}) => {
  await signIn(page, "owner@bill.test");
  await page.goto(url("/settings/billing"));
  await expect(page.getByText("Plan: Trial")).toBeVisible();
  await page.getByRole("button", { name: "Subscribe to Growth" }).click();
  await page.waitForURL(/checkout=done&mock_subscription=/);
  await expect(
    page.getByRole("status").filter({ hasText: /payment provider confirms/ }),
  ).toBeVisible();
  await expect(page.getByText("Plan: Trial")).toBeVisible(); // redirect alone changes nothing
  const subscriptionId = new URL(page.url()).searchParams.get("mock_subscription")!;

  // A forged event is refused and changes nothing.
  const forged = await page.request.post(
    url(`/api/webhooks/razorpay/${agencyId}`),
    webhook(subscriptionId, "evt_forged", "not-the-secret"),
  );
  expect(forged.status()).toBe(400);

  await setMockGatewaySubscription(subscriptionId, "active", Date.now() + 30 * 86_400_000);
  const ok = await page.request.post(
    url(`/api/webhooks/razorpay/${agencyId}`),
    webhook(subscriptionId, "evt_paid"),
  );
  expect(ok.status()).toBe(200);
  const again = await page.request.post(
    url(`/api/webhooks/razorpay/${agencyId}`),
    webhook(subscriptionId, "evt_paid"),
  );
  expect(again.status()).toBe(200);

  // Tenant config is cached per instance for up to APP_TENANT_CACHE_TTL_SECONDS (1 s here, 60 s
  // in production); reload until the confirmed plan shows.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("Plan: Growth")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByText("Status: Active")).toBeVisible();
  await expect(page.getByRole("region", { name: "Payment history" }).getByRole("row")).toHaveCount(
    2,
  ); // header + 1 payment
});

test("admins can see billing but not change it", async ({ page }) => {
  await signIn(page, "admin@bill.test");
  await page.goto(url("/settings/billing"));
  await expect(page.getByText("Plan: Growth")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel subscription" })).toHaveCount(0);
});
