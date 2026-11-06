import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  emulatorEnabled,
  resetEmulators,
  seedAgencyInvitation,
  seedCrmSample,
  seedMember,
  seedWorkspace,
} from "./support/emulator";

// TC-A11Y-001: axe (WCAG 2.0/2.1/2.2 A + AA) on every workspace and console route, light and dark.
// Zero serious/critical violations allowed.
test.skip(!emulatorEnabled(), "requires emulators (pnpm test:e2e:auth)");
test.describe.configure({ mode: "serial" });

const PORT = process.env.E2E_PORT ?? "3100";
const CONSOLE_PORT = process.env.E2E_CONSOLE_PORT ?? "3200";
const HOST = `a11y.app.localhost:${PORT}`;
const PARTNERS = `partners.localhost:${CONSOLE_PORT}`;
const url = (host: string, path = "/") => `http://${host}${path}`;
const PASSWORD = "correct horse battery staple";
let ids: Awaited<ReturnType<typeof seedCrmSample>>;
let tenantId = "";
let agencyId = "";
let workspaceCookies: Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>> = [];
let partnersCookies: typeof workspaceCookies = [];

async function scan(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = result.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${label}: ${v.id} — ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
  ).toEqual([]);
}

test.beforeAll(async ({ browser }) => {
  await resetEmulators();
  ({ tenantId, agencyId } = await seedWorkspace("a11y", HOST, "Access Co"));
  const ownerUid = await seedMember(tenantId, "owner@a11y.test", PASSWORD, "owner");
  ids = await seedCrmSample(tenantId, ownerUid);

  const page = await (await browser.newContext()).newPage();
  await page.goto(url(HOST, "/login"));
  await page.getByLabel("Email").fill("owner@a11y.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to/ })).toBeVisible();
  workspaceCookies = await page.context().cookies(url(HOST));

  const token = await seedAgencyInvitation(agencyId, PARTNERS, "staff@a11y.test");
  await page.goto(url(PARTNERS, `/invite/${token}`));
  await page.getByLabel("Your name").fill("Staff");
  await page.getByLabel("Choose a password").fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page.getByText("Invitation accepted. Sign in to continue.")).toBeVisible();
  await page.goto(url(PARTNERS, "/login"));
  await page.getByLabel("Email").fill("staff@a11y.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("region", { name: "Workspaces list" })).toBeVisible();
  partnersCookies = await page.context().cookies(url(PARTNERS));
});

const workspaceRoutes = () => [
  "/",
  "/contacts",
  "/contacts?filter=stage&value=customer",
  "/contacts/new",
  `/contacts/${ids.contactId}`,
  `/contacts/${ids.contactId}/edit`,
  "/companies",
  `/companies/${ids.companyId}`,
  "/leads",
  `/leads/${ids.leadId}`,
  "/deals",
  `/deals/${ids.dealId}`,
  "/pipeline",
  "/tasks",
  `/tasks/${ids.taskId}`,
  "/my-tasks",
  "/reports",
  "/trash",
  "/settings/profile",
  "/settings/workspace",
  "/settings/pipeline",
  "/settings/members",
  "/settings/branding",
  "/settings/emails",
  "/settings/usage",
  "/settings/import",
  "/settings/audit",
  "/settings/privacy",
];

for (const scheme of ["light", "dark"] as const) {
  test(`workspace routes have no serious/critical axe violations (${scheme})`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.context().addCookies(workspaceCookies);
    for (const path of workspaceRoutes()) {
      await page.goto(url(HOST, path));
      await expect(page.locator("main h1").first()).toBeVisible();
      await scan(page, `${scheme} ${path}`);
    }
  });
}

test("open dialogs and the search palette are accessible", async ({ page }) => {
  await page.context().addCookies(workspaceCookies);
  await page.goto(url(HOST, `/leads/${ids.leadId}`));
  await page.getByRole("button", { name: "Convert lead" }).click();
  await scan(page, "convert dialog");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Search (Ctrl+K)" }).click();
  await page.getByLabel("Search contacts, companies, leads and deals").fill("sam");
  await expect(page.getByRole("link", { name: /Sam Sample/ })).toBeVisible();
  await scan(page, "search palette");
});

test("signed-out and console pages have no serious/critical axe violations", async ({ page }) => {
  test.setTimeout(120_000);
  for (const path of ["/login", "/reset-password", "/unsubscribe?t=bad", "/does-not-exist"]) {
    await page.goto(url(HOST, path));
    await scan(page, `public ${path}`);
  }
  await page.goto(url(PARTNERS, "/login"));
  await scan(page, "partners login");
  await page.goto(url(`console.localhost:${CONSOLE_PORT}`, "/login"));
  await scan(page, "console login");
  await page.context().addCookies(partnersCookies);
  for (const path of ["/", `/workspaces/${tenantId}`, "/settings", "/report"]) {
    await page.goto(url(PARTNERS, path));
    await expect(page.locator("h1").first()).toBeVisible();
    await scan(page, `partners ${path}`);
  }
});
