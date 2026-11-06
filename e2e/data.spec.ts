import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  emulatorEnabled,
  resetEmulators,
  seedContact,
  seedMember,
  seedWorkspace,
} from "./support/emulator";
import { failOnCspViolations } from "./support/csp";

// Data journeys (requirements/09 §7): 6 CSV import with error report, 7 list export with formula
// protection, 10 global search, 14 DSAR export/erasure; plus dashboard and notifications.
test.skip(!emulatorEnabled(), "requires emulators (pnpm test:e2e:auth)");
test.describe.configure({ mode: "serial" });
failOnCspViolations(test);

const PORT = process.env.E2E_PORT ?? "3100";
const HOST = `data.app.localhost:${PORT}`;
const url = (path = "/") => `http://${HOST}${path}`;
const PASSWORD = "correct horse battery staple";
let tenantId = "";
let ownerUid = "";
let cookies: Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>> | null = null;

const toast = (page: Page, text: string | RegExp) =>
  expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();

async function signIn(page: Page) {
  if (cookies) {
    await page.context().addCookies(cookies);
    return;
  }
  await page.goto(url("/login"));
  await page.getByLabel("Email").fill("owner@data.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to/ })).toBeVisible();
  cookies = await page.context().cookies(url());
}

test.beforeAll(async () => {
  await resetEmulators();
  ({ tenantId } = await seedWorkspace("data", HOST, "Data Co"));
  ownerUid = await seedMember(tenantId, "owner@data.test", PASSWORD, "owner");
});

test("CSV import shows a preview, skips bad rows, and offers an error report (journey 6, TC-IMP-001)", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(url("/settings/import"));
  await page.getByLabel("CSV file").setInputFiles({
    name: "people.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "First Name,Last Name,Email\nImogen,Price,imogen@data.test\n,Nameless,bad\nIvan,Petrov,ivan@data.test\n",
    ),
  });
  await page.getByRole("button", { name: "Upload and preview" }).click();
  await expect(page.getByText("1 rows have problems and will be skipped.")).toBeVisible();
  await expect(page.getByLabel("Field for column “Email”")).toHaveValue("email");
  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await toast(page, /Import started/);
  await page.reload();
  const job = page.locator("[data-job]").filter({ hasText: "contacts import" }).first();
  await expect(job).toContainText("Finished with errors");
  const downloadPromise = page.waitForEvent("download");
  await job.getByRole("link", { name: "Download errors.csv" }).click();
  const report = await readFile((await (await downloadPromise).path())!, "utf8");
  expect(report).toContain("3,");
  await page.goto(url("/contacts"));
  await expect(page.getByRole("region", { name: "Contacts list" })).toContainText("Imogen Price");
});

test("list export neutralises spreadsheet formulas (journey 7, TC-IMP-002)", async ({ page }) => {
  await seedContact(tenantId, ownerUid, '=HYPERLINK("x")', { fullNameLower: "zz formula" });
  await signIn(page);
  await page.goto(url("/contacts"));
  await page.getByRole("button", { name: "Export CSV" }).click();
  await toast(page, /Export started/);
  await page.goto(url("/settings/import"));
  const job = page.locator("[data-job]").filter({ hasText: "contacts export" }).first();
  const downloadPromise = page.waitForEvent("download");
  await job.getByRole("link", { name: "Download contacts.csv" }).click();
  const csv = await readFile((await (await downloadPromise).path())!, "utf8");
  expect(csv).toContain("'=HYPERLINK");
  expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
});

test("global search finds records by word prefix (journey 10, TC-SRCH-001)", async ({ page }) => {
  await signIn(page);
  await page.goto(url("/"));
  await page.getByRole("button", { name: "Search (Ctrl+K)" }).click();
  await page.getByLabel("Search contacts, companies, leads and deals").fill("imo");
  const result = page.getByRole("link", { name: /Imogen Price/ });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.getByRole("heading", { name: "Imogen Price" })).toBeVisible();
});

test("dashboard and notifications render for the owner", async ({ page }) => {
  await signIn(page);
  await page.goto(url("/"));
  await expect(page.getByRole("region", { name: "Deals won" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Open pipeline by stage", exact: true }),
  ).toBeVisible();
  // The import/export jobs above produced "finished" notifications.
  await page.getByRole("button", { name: /Notifications/ }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText(/contacts (import|export)/)
      .first(),
  ).toBeVisible();
});

test("DSAR export and erasure (journey 14, TC-PRIV-001/002)", async ({ page }) => {
  await signIn(page);
  await page.goto(url("/settings/privacy"));
  await page.getByLabel("Contact", { exact: true }).selectOption({ label: "Ivan Petrov" });
  const downloads: string[] = [];
  page.on("download", async (d) => downloads.push(await readFile((await d.path())!, "utf8")));
  await page.getByRole("button", { name: "Export contact data" }).click();
  await expect.poll(() => downloads.length).toBe(2);
  expect(downloads.join("\n")).toContain("ivan@data.test");

  await page.getByRole("button", { name: "Erase contact" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Erase contact" }).click();
  await toast(page, "Contact erased.");
  await page.goto(url("/contacts"));
  await expect(page.getByRole("region", { name: "Contacts list" })).not.toContainText(
    "Ivan Petrov",
  );
});
