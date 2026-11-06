import { expect, test } from "@playwright/test";
import {
  emulatorEnabled,
  queryOutbox,
  resetEmulators,
  seedInvitation,
  seedMember,
  seedWorkspace,
} from "./support/emulator";
import { expectNoncedPage, failOnCspViolations } from "./support/csp";

// Browser auth flows on workspace hosts, against the Firebase emulators.
// Run with `pnpm test:e2e:auth` (TC-AUTH-001/004/005, TC-RBAC-001, TC-TEN-004, TC-SEC-001).
test.skip(!emulatorEnabled(), "requires emulators (pnpm test:e2e:auth)");
test.describe.configure({ mode: "serial" });
failOnCspViolations(test);

const PORT = process.env.E2E_PORT ?? "3100";
const ACME = `acme.app.localhost:${PORT}`;
const GLOBEX = `globex.app.localhost:${PORT}`;
const url = (host: string, path = "/") => `http://${host}${path}`;
const PASSWORD = "correct horse battery staple";

let acme: { tenantId: string };

test.beforeAll(async () => {
  await resetEmulators();
  acme = await seedWorkspace("acme", ACME, "Acme Widgets");
  await seedWorkspace("globex", GLOBEX, "Globex Corp");
});

test("owner accepts an invitation, signs in, and signs out everywhere", async ({ page }) => {
  const token = await seedInvitation(acme.tenantId, ACME, "olivia@acme.test");

  await page.goto(url(ACME, `/invite/${token}`));
  await expect(page.getByRole("heading", { name: "You're invited" })).toBeVisible();
  await page.getByLabel("Your name").fill("Olivia Owner");
  await page.getByLabel("Choose a password").fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page.getByText("Invitation accepted. Sign in to continue.")).toBeVisible();

  // Single use: the same link no longer works.
  await page.goto(url(ACME, `/invite/${token}`));
  await expect(page.getByText(/invalid, already used, or expired/)).toBeVisible();

  await page.goto(url(ACME, "/login"));
  await expect(page.getByRole("heading", { name: "Sign in to Acme Widgets" })).toBeVisible();
  await page.getByLabel("Email").fill("olivia@acme.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome to Acme Widgets" })).toBeVisible();
  await expect(page.getByText("You're signed in as owner.")).toBeVisible();

  const cookies = await page.context().cookies(url(ACME));
  const session = cookies.find((c) => c.name === "session");
  expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax" });

  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page).toHaveURL(url(ACME, "/login"));
  await page.goto(url(ACME, "/"));
  await expect(page).toHaveURL(url(ACME, "/login"));
});

test("wrong password shows one generic message", async ({ page }) => {
  await seedMember(acme.tenantId, "raj@acme.test", PASSWORD);
  await page.goto(url(ACME, "/login"));
  await page.getByLabel("Email").fill("raj@acme.test");
  await page.getByLabel("Password").fill("not-the-password-at-all");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "Email or password is incorrect.",
  );

  await page.getByLabel("Email").fill("nobody@acme.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "Email or password is incorrect.",
  );
});

test("a member of one workspace cannot sign in to another (TC-SEC-001)", async ({ page }) => {
  await page.goto(url(GLOBEX, "/login"));
  await page.getByLabel("Email").fill("raj@acme.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "This account doesn't have access here.",
  );
  expect(
    (await page.context().cookies(url(GLOBEX))).find((c) => c.name === "session"),
  ).toBeUndefined();
});

test("password reset gives the same answer for unknown emails (TC-AUTH-003)", async ({ page }) => {
  for (const email of ["raj@acme.test", "nobody@acme.test"]) {
    await page.goto(url(ACME, "/reset-password"));
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(
      page.getByText("If an account exists for that email, a reset link is on its way."),
    ).toBeVisible();
  }
});

test("unknown hosts and the internal rewrite path return 404; workspace hosts are noindex", async ({
  request,
}) => {
  const unknown = await request.get(url(`nope.app.localhost:${PORT}`, "/login"));
  expect(unknown.status()).toBe(404);
  const internal = await request.get(url(ACME, `/t/${ACME}/login`));
  expect(internal.status()).toBe(404);
  const login = await request.get(url(ACME, "/login"));
  expect(login.headers()["x-robots-tag"]).toContain("noindex");
});

test("session endpoint rejects cross-site requests (TC-SEC-011)", async ({ request }) => {
  const noHeader = await request.post(url(ACME, "/api/auth/session"), {
    data: { idToken: "x".repeat(40) },
    headers: { Origin: url(ACME).slice(0, -1) },
  });
  expect(noHeader.status()).toBe(403);
  const crossOrigin = await request.post(url(ACME, "/api/auth/session"), {
    data: { idToken: "x".repeat(40) },
    headers: { Origin: "https://evil.test", "X-CRM-Request": "1" },
  });
  expect(crossOrigin.status()).toBe(403);
  expect(crossOrigin.headers()["cache-control"]).toContain("no-store");
});

test("workspace pages ship strict security headers and a per-request CSP nonce (TC-SEC-006)", async ({
  page,
}) => {
  const first = await page.goto(url(ACME, "/login"));
  const headers = first!.headers();
  await expectNoncedPage(page, headers["content-security-policy"]);
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("same-origin");
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["cache-control"]).toContain("private");
  const second = await page.goto(url(ACME, "/login"));
  expect(second!.headers()["content-security-policy"]).not.toBe(headers["content-security-policy"]);
});

test("owner manages the team: invite, role change, removal ends access (TC-RBAC-001/003)", async ({
  page,
  browser,
}) => {
  const signIn = async (p: typeof page, email: string, password: string) => {
    await p.goto(url(ACME, "/login"));
    await p.getByLabel("Email").fill(email);
    await p.getByLabel("Password").fill(password);
    await p.getByRole("button", { name: "Sign in" }).click();
    await expect(p.getByRole("heading", { name: "Welcome to Acme Widgets" })).toBeVisible();
  };
  await signIn(page, "olivia@acme.test", PASSWORD);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Team" }).click();
  await expect(page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();

  await page.getByLabel("Email").fill("mia@acme.test");
  await page.getByLabel("Role", { exact: true }).selectOption("member");
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Invitation sent to mia@acme.test.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Pending invitations list" })).toContainText(
    "mia@acme.test",
  );

  const mail = (await queryOutbox("workspace_invitation")).find((m) => m.to === "mia@acme.test");
  const token = String(mail?.variables?.link).split("/invite/")[1];
  const mia = await (await browser.newContext()).newPage();
  await mia.goto(url(ACME, `/invite/${token}`));
  await mia.getByLabel("Your name").fill("Mia Member");
  await mia.getByLabel("Choose a password").fill(PASSWORD);
  await mia.getByLabel("Confirm password").fill(PASSWORD);
  await mia.getByRole("button", { name: "Create account and join" }).click();
  await expect(mia.getByText("Invitation accepted. Sign in to continue.")).toBeVisible();
  await signIn(mia, "mia@acme.test", PASSWORD);
  await expect(mia.getByText("You're signed in as member.")).toBeVisible();

  await page.reload();
  await page.getByLabel("Role for Mia Member").selectOption("viewer");
  await expect(page.getByText("Role updated.")).toBeVisible();
  await mia.reload();
  await expect(mia.getByText("You're signed in as viewer.")).toBeVisible();

  await page.getByRole("button", { name: "Remove: Mia Member" }).click();
  await page.getByRole("button", { name: "Remove from workspace" }).click();
  await expect(page.getByText(/Mia Member was removed/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Members list" })).not.toContainText(
    "mia@acme.test",
  );

  await mia.reload();
  await expect(mia).toHaveURL(url(ACME, "/login"));
});
