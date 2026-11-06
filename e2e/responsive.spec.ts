import { expect, test, type Page } from "@playwright/test";
import { emulatorEnabled, seedCrmSample, seedMember, seedWorkspace } from "./support/emulator";

// TC-RESP-001: viewport matrix (run with --project android/tablet/chromium-desktop). No horizontal
// page overflow on any main route; navigation works through the drawer on small screens; core
// journeys (record detail, board move, task completion) are usable.
test.skip(!emulatorEnabled(), "requires emulators (pnpm test:e2e:auth)");
test.describe.configure({ mode: "serial" });

const PORT = process.env.E2E_PORT ?? "3100";
const PASSWORD = "correct horse battery staple";
let host = "";
let ids: Awaited<ReturnType<typeof seedCrmSample>>;

async function noOverflow(page: Page, label: string) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scroll, `${label}: page scrolls horizontally`).toBeLessThanOrEqual(width);
}

test.beforeAll(async ({}, info) => {
  // One workspace per project so parallel projects don't share state.
  const slug = `resp${info.project.name.replace(/[^a-z0-9]/g, "")}`;
  host = `${slug}.app.localhost:${PORT}`;
  const { tenantId } = await seedWorkspace(slug, host, "Responsive Co");
  const owner = await seedMember(tenantId, `owner@${slug}.test`, PASSWORD, "owner");
  ids = await seedCrmSample(tenantId, owner);
});

test("main routes fit the viewport and navigation works", async ({ page }, info) => {
  test.setTimeout(180_000);
  const url = (path = "/") => `http://${host}${path}`;
  const slug = host.split(".")[0];
  await page.goto(url("/login"));
  await page.getByLabel("Email").fill(`owner@${slug}.test`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to/ })).toBeVisible();

  for (const path of [
    "/",
    "/contacts",
    `/contacts/${ids.contactId}`,
    "/contacts/new",
    "/deals",
    `/deals/${ids.dealId}`,
    "/pipeline",
    "/my-tasks",
    "/reports",
    "/settings/profile",
    "/settings/branding",
    "/settings/import",
  ]) {
    await page.goto(url(path));
    await expect(page.locator("main h1").first()).toBeVisible();
    await noOverflow(page, `${info.project.name} ${path}`);
  }

  const small = (page.viewportSize()?.width ?? 1280) < 1024;
  await page.goto(url("/"));
  if (small) {
    // Drawer navigation (06 §5.1).
    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("link", { name: "Contacts", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Contacts", level: 1 })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Cards instead of a table on phones.
    if ((page.viewportSize()?.width ?? 0) < 768) {
      await expect(page.getByRole("list", { name: "Contacts list" })).toContainText("Sam Sample");
    }
  } else {
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Contacts", exact: true })
      .click();
    await expect(page.getByRole("link", { name: "Contacts", exact: true }).first()).toHaveAttribute(
      "aria-current",
      "page",
    );
  }

  // Board: keyboard/select move works at every size.
  await page.goto(url("/pipeline"));
  await page.getByLabel("Move Sample renewal to stage").selectOption({ label: "Negotiation" });
  await expect(page.locator('[data-stage="stg_negotiation"]')).toContainText("Sample renewal");
});
