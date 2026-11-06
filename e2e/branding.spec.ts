import { expect, test, type Page } from "@playwright/test";
import {
  emulatorEnabled,
  getDoc,
  resetEmulators,
  seedAgencyInvitation,
  seedMember,
  seedWorkspace,
} from "./support/emulator";
import { failOnCspViolations } from "./support/csp";

// White-label journeys (requirements/09 §7 journey 8 + domains): branding visible on the login
// page and in email previews, unsafe uploads rejected, custom domain becomes the main address.
test.skip(!emulatorEnabled(), "requires emulators (pnpm test:e2e:auth)");
test.describe.configure({ mode: "serial" });
failOnCspViolations(test);

const PORT = process.env.E2E_PORT ?? "3100";
const CONSOLE_PORT = process.env.E2E_CONSOLE_PORT ?? "3200";
const FALLBACK = `brandco.app.localhost:${PORT}`;
const CUSTOM = `brand.localhost:${PORT}`;
const PARTNERS = `partners.localhost:${CONSOLE_PORT}`;
const url = (host: string, path = "/") => `http://${host}${path}`;
const PASSWORD = "correct horse battery staple";

// 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="alert(1)"><rect width="10" height="10"/></svg>',
);

let workspace: { tenantId: string; agencyId: string };

const toast = (page: Page, text: string | RegExp) =>
  expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();

async function signIn(page: Page) {
  await page.goto(url(FALLBACK, "/login"));
  await page.getByLabel("Email").fill("owner@brandco.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to/ })).toBeVisible();
}

test.beforeAll(async () => {
  await resetEmulators();
  workspace = await seedWorkspace("brandco", FALLBACK, "Brand Co");
  await seedMember(workspace.tenantId, "owner@brandco.test", PASSWORD, "owner");
});

test("branding update shows on the login page; unsafe uploads and colours are refused (journey 8, TC-BRAND-001/002)", async ({
  page,
  browser,
}) => {
  await signIn(page);
  await page.goto(url(FALLBACK, "/settings/branding"));
  await page.getByLabel("App name").fill("Northwind Sales");

  // Contrast safety (FR-BRAND-002 AC2): blocked with a suggestion.
  await page.getByLabel("Primary colour").fill("#777777");
  await expect(page.getByRole("alert").filter({ hasText: /contrast requirements/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  await page.getByLabel("Primary colour").fill("#0F766E");
  await page.getByRole("button", { name: "Save" }).click();
  await toast(page, /Branding saved/);

  // Unsafe upload refused server-side (SVG with script), then a real PNG accepted.
  await page.getByLabel("Logo (light backgrounds)").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: SVG,
  });
  await expect(page.getByRole("alert").filter({ hasText: /SVG/ })).toBeVisible();
  await page.getByLabel("Logo (light backgrounds)").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await toast(page, "Uploaded.");

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(url(FALLBACK, "/login"));
  await expect(visitor.getByRole("img", { name: "Northwind Sales" }).first()).toBeVisible();
  const primary = await visitor.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
  );
  expect(primary).toBe("#0F766E");
  await expect(visitor).toHaveTitle(/Northwind Sales/);
  await expect(visitor.getByText("Powered by CRM")).toBeVisible(); // trial plan keeps the badge
  const logo = await visitor.request.get(
    (await visitor.getByRole("img", { name: "Northwind Sales" }).first().getAttribute("src"))!,
  );
  expect(logo.headers()["content-type"]).toBe("image/png");
  expect(logo.headers()["cache-control"]).toContain("immutable");
});

test("email overrides preview with branding and refuse links (TC-BRAND-003)", async ({ page }) => {
  await signIn(page);
  await page.goto(url(FALLBACK, "/settings/emails"));
  await page.getByLabel("Subject").fill("Welcome to {{tenant.name}}");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("email-preview-subject")).toHaveText("Welcome to Brand Co");
  const frame = page.frameLocator('iframe[title="Email preview"]');
  await expect(frame.getByRole("img", { name: "Northwind Sales" })).toBeVisible();

  await page.getByLabel("Intro paragraph").fill("Pay now at https://evil.test");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Links aren't allowed")).toBeVisible();
});

test("agency adds a custom domain, verifies it, and makes it the main address (TC-TEN-008)", async ({
  page,
}) => {
  const token = await seedAgencyInvitation(workspace.agencyId, PARTNERS, "ava@agency.test");
  await page.goto(url(PARTNERS, `/invite/${token}`));
  await page.getByLabel("Your name").fill("Ava");
  await page.getByLabel("Choose a password").fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page.getByText("Invitation accepted. Sign in to continue.")).toBeVisible();
  await page.goto(url(PARTNERS, "/login"));
  await page.getByLabel("Email").fill("ava@agency.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await page.getByRole("link", { name: "Brand Co" }).click();
  await expect(page.getByRole("heading", { name: "Brand Co", level: 1 })).toBeVisible();
  await page.getByLabel("Domain", { exact: true }).fill(CUSTOM);
  await page.getByRole("button", { name: "Add domain" }).click();
  await toast(page, /Domain added/);
  await expect(page.getByRole("region", { name: `DNS records for ${CUSTOM}` })).toContainText(
    "76.76.21.21", // 2-label host → apex → A record
  );

  await page.getByRole("button", { name: `Check ${CUSTOM}` }).click();
  await toast(page, "Status: Active.");
  await page.getByRole("button", { name: `Make ${CUSTOM} the main address` }).click();
  await toast(page, /Main address updated/);
  expect((await getDoc(`tenants/${workspace.tenantId}`))?.canonicalHost).toBe(CUSTOM);

  // The platform fallback host now 301-redirects to the custom domain.
  await page.waitForTimeout(1100); // config cache TTL in E2E is 1 s
  await page.goto(url(FALLBACK, "/login?x=1"));
  await expect(page).toHaveURL(url(CUSTOM, "/login?x=1"));
  await expect(page.getByRole("heading", { name: "Sign in to Brand Co" })).toBeVisible();
});
