import { expect, test } from "@playwright/test";
import { signInWithGoogle, signInWithPassword } from "@crm/testing/auth-emulator";
import {
  emulatorEnabled,
  getDoc,
  queryOutbox,
  resetEmulators,
  seedAgencyInvitation,
  seedWorkspace,
  setDoc,
} from "./support/emulator";
import { expectNoncedPage, failOnCspViolations } from "./support/csp";

// Platform and agency consoles against the emulators (TC-AGY-001/002/003, TC-AUTH-007, TC-TEN-002).
test.skip(!emulatorEnabled(), "requires emulators (pnpm test:e2e:auth)");
test.describe.configure({ mode: "serial" });
failOnCspViolations(test);

const WEB_PORT = process.env.E2E_PORT ?? "3100";
const PORT = process.env.E2E_CONSOLE_PORT ?? "3200";
const CONSOLE = `console.localhost:${PORT}`;
const PARTNERS = `partners.localhost:${PORT}`;
const url = (host: string, path = "/") => `http://${host}${path}`;
const PASSWORD = "agency owner passphrase 1";

let one: { tenantId: string; agencyId: string };
let two: { tenantId: string; agencyId: string };

test.beforeAll(async () => {
  await resetEmulators();
  one = await seedWorkspace("acme", `acme.app.localhost:${WEB_PORT}`, "Acme Widgets");
  two = await seedWorkspace("initech", `initech.app.localhost:${WEB_PORT}`, "Initech");
});

test("agency owner joins, sees only their own workspaces, and suspends one", async ({ page }) => {
  const token = await seedAgencyInvitation(one.agencyId, PARTNERS, "priya@agency.test");
  await page.goto(url(PARTNERS, `/invite/${token}`));
  await page.getByLabel("Your name").fill("Priya");
  await page.getByLabel("Choose a password").fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page.getByText("Invitation accepted. Sign in to continue.")).toBeVisible();

  await page.goto(url(PARTNERS, "/login"));
  await page.getByLabel("Email").fill("priya@agency.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  const table = page.getByRole("region", { name: "Workspaces list" });
  await expect(table.getByRole("rowheader", { name: "Acme Widgets" })).toBeVisible();
  // Another agency's workspace is never listed (TC-AGY-003).
  await expect(table.getByText("Initech")).toHaveCount(0);

  await page.getByRole("button", { name: "Suspend: Acme Widgets" }).click();
  await expect(page.getByRole("button", { name: "Reactivate: Acme Widgets" })).toBeVisible();
  expect((await getDoc(`tenants/${one.tenantId}`))?.status).toBe("suspended");
  expect((await getDoc(`tenants/${two.tenantId}`))?.status).toBe("active");
});

test("agency staff cannot act on another agency's workspace by ID (TC-AGY-003)", async ({
  page,
}) => {
  await page.goto(url(PARTNERS, "/login"));
  await page.getByLabel("Email").fill("priya@agency.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("region", { name: "Workspaces list" })).toBeVisible();
  // Invoke the Server Action with a foreign tenant ID by rewriting a real request.
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.headers()["next-action"]) {
      const body = (req.postData() ?? "").replace(one.tenantId, two.tenantId);
      return route.continue({ postData: body });
    }
    return route.continue();
  });
  await page.getByRole("button", { name: "Reactivate: Acme Widgets" }).click();
  await expect(page.getByText("We couldn't find what you were looking for.")).toBeVisible();
  expect((await getDoc(`tenants/${two.tenantId}`))?.status).toBe("active");
});

test("platform staff: Google identity from the allowed domain provisions an agency (TC-AUTH-007)", async ({
  page,
}) => {
  const { idToken, uid } = await signInWithGoogle({ sub: "g-ops", email: "ops@example.com" });
  await setDoc(`platformAdmins/${uid}`, { role: "superadmin", email: "ops@example.com" });

  const res = await page.request.post(url(CONSOLE, "/api/auth/session"), {
    data: { idToken },
    headers: { Origin: url(CONSOLE).slice(0, -1), "X-CRM-Request": "1" },
  });
  expect(res.status()).toBe(200);

  await page.goto(url(CONSOLE, "/"));
  await expect(page.getByRole("heading", { name: "Agencies" })).toBeVisible();
  await page.getByLabel("Name").first().fill("Agency Three");
  await page.getByLabel("Short name (used in the address)").first().fill("agency-three");
  await page.getByLabel("Owner email").first().fill("owner@three.test");
  await page.getByRole("button", { name: "Create agency" }).click();
  await expect(
    page.getByText("Agency created. An invitation was sent to the owner."),
  ).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Agency Three" })).toBeVisible();

  const invites = await queryOutbox("agency_invitation");
  expect(invites.map((m) => m.to)).toContain("owner@three.test");
  // First privileged sign-in from this device triggers a login alert (FR-AUTH-008 AC4).
  expect((await queryOutbox("privileged_login_alert")).length).toBeGreaterThan(0);
});

test("platform console refuses password identities even with an admin record", async ({ page }) => {
  const res0 = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "ops2@example.com",
        password: "pw-123456789012",
        returnSecureToken: true,
      }),
    },
  );
  const { localId } = (await res0.json()) as { localId: string };
  await setDoc(`platformAdmins/${localId}`, { role: "superadmin", email: "ops2@example.com" });
  // Mark verified so the only failing check is the sign-in provider.
  await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/demo-crm/accounts:update`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
      body: JSON.stringify({ localId, emailVerified: true }),
    },
  );
  const idToken = await signInWithPassword("ops2@example.com", "pw-123456789012");
  const res = await page.request.post(url(CONSOLE, "/api/auth/session"), {
    data: { idToken },
    headers: { Origin: url(CONSOLE).slice(0, -1), "X-CRM-Request": "1" },
  });
  expect(res.status()).toBe(403);
});

test("console hosts are noindex and internal paths are hidden", async ({ request }) => {
  const login = await request.get(url(CONSOLE, "/login"));
  expect(login.headers()["x-robots-tag"]).toContain("noindex");
  expect((await request.get(url(CONSOLE, "/platform/login"))).status()).toBe(404);
  expect((await request.get(url(`acme.app.localhost:${PORT}`, "/login"))).status()).toBe(404);
});

test("console pages ship a per-request CSP nonce and private caching", async ({ page }) => {
  const res = await page.goto(url(PARTNERS, "/login"));
  await expectNoncedPage(page, res!.headers()["content-security-policy"]);
  expect(res!.headers()["cache-control"]).toContain("no-store");
});
