import { expect, test, type Page } from "@playwright/test";
import {
  emulatorEnabled,
  resetEmulators,
  seedContact,
  seedMember,
  seedWorkspace,
} from "./support/emulator";
import { APP_JS_BUDGET, initialJsBytes } from "./support/budget";
import { failOnCspViolations } from "./support/csp";

// Core CRM journeys against the emulators (requirements/09 §7): 3 lead→deal→won, 4 tasks,
// 5 activities + sanitization, 9 lists, 11 trash, 15 validation, 17 Member own-scope.
test.skip(!emulatorEnabled(), "requires emulators (pnpm test:e2e:auth)");
test.describe.configure({ mode: "serial" });
failOnCspViolations(test);

const PORT = process.env.E2E_PORT ?? "3100";
const HOST = `crm.app.localhost:${PORT}`;
const url = (path = "/") => `http://${HOST}${path}`;
const PASSWORD = "correct horse battery staple";

let tenantId = "";
let ownerUid = "";
let rajUid = "";
let lenaUid = "";

// One real sign-in per user; later tests reuse the session cookie (the login rate limiter
// would otherwise — correctly — block a burst of sign-ins from one IP).
const sessions = new Map<string, Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>>();

async function signIn(page: Page, email: string) {
  const saved = sessions.get(email);
  if (saved) {
    await page.context().addCookies(saved);
    await page.goto(url("/"));
    await expect(page.getByRole("heading", { name: /Welcome to/ })).toBeVisible();
    return;
  }
  await page.goto(url("/login"));
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to/ })).toBeVisible();
  sessions.set(email, await page.context().cookies(url()));
}

const toast = (page: Page, text: string | RegExp) =>
  expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();

test.beforeAll(async () => {
  await resetEmulators();
  ({ tenantId } = await seedWorkspace("crm", HOST, "Northwind CRM"));
  ownerUid = await seedMember(tenantId, "owner@northwind.test", PASSWORD, "owner");
  rajUid = await seedMember(tenantId, "raj@northwind.test", PASSWORD, "member");
  lenaUid = await seedMember(tenantId, "lena@northwind.test", PASSWORD, "member");
});

test("form validation maps server errors inline and keeps input (journey 15, TC-CON-001, TC-DEAL-001)", async ({
  page,
}) => {
  await signIn(page, "owner@northwind.test");
  await page.goto(url("/contacts/new"));
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Job title").fill("Buyer");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Required")).toBeVisible();
  await expect(page.getByText("Enter a valid email")).toBeVisible();
  await expect(page.getByLabel("First name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Job title")).toHaveValue("Buyer");

  await page.goto(url("/deals/new"));
  await page.getByLabel("Name").fill("Bad amount");
  await page.getByLabel("Amount").fill("12.345");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Enter (a valid amount|an amount like)/)).toBeVisible();
  await expect(page.getByLabel("Amount")).toHaveValue("12.345");
});

test("lead → convert → move stages (drag and keyboard) → won marks customer (journey 3)", async ({
  page,
}) => {
  await signIn(page, "owner@northwind.test");
  await page.getByRole("link", { name: "Leads" }).first().click();
  await page.getByRole("link", { name: "New lead" }).click();
  await page.getByLabel("First name").fill("Nina");
  await page.getByLabel("Last name").fill("Lopez");
  await page.getByLabel("Email").fill("nina@newco.test");
  await page.getByLabel("Company name").fill("NewCo");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Nina Lopez" })).toBeVisible();

  await page.getByRole("button", { name: "Convert lead" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Company")).toHaveValue("new");
  await dialog.getByLabel(/Deal amount/).fill("2500");
  await dialog.getByRole("button", { name: "Convert" }).click();
  await toast(page, "Lead converted.");
  await expect(page.getByRole("heading", { name: "Nina Lopez" })).toBeVisible();
  await expect(page).toHaveURL(/\/contacts\//);
  const contactUrl = page.url();

  await page.goto(url("/pipeline"));
  const card = page.locator("[data-deal]").filter({ hasText: "NewCo deal" });
  await expect(page.locator('[data-stage="stg_qualification"]')).toContainText("NewCo deal");
  await card.dragTo(page.locator('[data-stage="stg_discovery"]'));
  await toast(page, "Moved to Discovery.");
  await expect(page.locator('[data-stage="stg_discovery"]')).toContainText("NewCo deal");

  // Keyboard-operable alternative (WCAG 2.5.7).
  await page.getByLabel("Move NewCo deal to stage").selectOption({ label: "Proposal" });
  await toast(page, "Moved to Proposal.");
  await expect(page.locator('[data-stage="stg_proposal"]')).toContainText("NewCo deal");

  await page.getByRole("link", { name: "NewCo deal" }).click();
  await page.getByRole("button", { name: "Mark won" }).click();
  await expect(page.getByLabel("Set the primary contact's stage to Customer")).toBeChecked();
  await page.getByRole("dialog").getByRole("button", { name: "Mark won" }).click();
  await toast(page, "Deal marked won.");
  await expect(page.getByText("This deal is won.")).toBeVisible();
  await expect(page.getByText("Stage changed: Discovery → Proposal")).toBeVisible();

  await page.goto(contactUrl);
  await expect(page.locator("dd", { hasText: "Customer" })).toBeVisible();
  await page.getByRole("link", { name: "Customers" }).click();
  await expect(page.getByRole("region", { name: "Customers list" })).toContainText("Nina Lopez");
});

test("activities: newest first, Markdown rendered safely (journey 5, TC-ACT-001, TC-SEC-010)", async ({
  page,
}) => {
  const id = await seedContact(tenantId, ownerUid, "Tim");
  await signIn(page, "owner@northwind.test");
  await page.goto(url(`/contacts/${id}`));

  const log = async (subject: string, body: string, date: string) => {
    await page.getByLabel("Subject").fill(subject);
    await page.getByLabel("Notes").fill(body);
    await page.getByLabel("Date", { exact: true }).fill(date);
    await page.getByRole("button", { name: "Log activity" }).click();
    await toast(page, "Activity logged.");
  };
  await log("First call", '**Important** <img src=x onerror="window.__xss=1">', "2026-01-05");
  await log(
    "Second call",
    "[evil](javascript:alert(1)) and [safe](https://northwind.test)",
    "2026-01-06",
  );

  const items = page.locator("ol > li");
  await expect(items.filter({ hasText: "Second call" })).toBeVisible();
  const order = await items.allTextContents();
  expect(order.findIndex((t) => t.includes("Second call"))).toBeLessThan(
    order.findIndex((t) => t.includes("First call")),
  );
  await expect(page.locator("ol strong", { hasText: "Important" })).toBeVisible();
  await expect(page.locator("ol img")).toHaveCount(0);
  await expect(page.getByText('<img src=x onerror="window.__xss=1">')).toBeVisible();
  await expect(page.locator('ol a[href^="javascript"]')).toHaveCount(0);
  await expect(page.locator('ol a[href="https://northwind.test"]')).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
  ).toBeUndefined();
});

test("tasks appear in My tasks and complete (journey 4, TC-TASK-001/002)", async ({ page }) => {
  await signIn(page, "raj@northwind.test");
  await page.goto(url("/tasks/new"));
  await page.getByLabel("Title").fill("Send proposal");
  await page.getByLabel("Due date").fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel("Priority").selectOption("high");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Send proposal" })).toBeVisible();

  await page.getByRole("link", { name: /My tasks/ }).click();
  await expect(page.getByRole("link", { name: /My tasks \(1 due\)/ })).toBeVisible();
  await expect(page.getByRole("region", { name: /Today/ })).toContainText("Send proposal");
  await page.getByLabel("Mark Send proposal done").check();
  await toast(page, "Task completed.");
  await expect(page.getByText("You have no open tasks.")).toBeVisible();
});

test("lists: sort, filter, and paginate without gaps under inserts (journey 9, TC-SRCH-002)", async ({
  page,
}) => {
  for (let i = 0; i < 28; i++) {
    await seedContact(tenantId, ownerUid, `Page ${String(i).padStart(2, "0")}`, {
      lifecycleStage: i % 2 ? "customer" : "subscriber",
    });
  }
  await signIn(page, "owner@northwind.test");
  await page.goto(url("/contacts"));
  await page.getByLabel("Sort by").selectOption("name");
  await page.getByLabel("Filter", { exact: true }).selectOption("stage");
  await page.getByLabel("Stage", { exact: true }).selectOption("subscriber");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/sort=name&filter=stage&value=subscriber/);
  await expect(page.getByRole("status").filter({ hasText: "14 records" })).toBeVisible();

  await page.goto(url("/contacts?sort=name"));
  const names = async () =>
    (
      await page
        .getByRole("region", { name: "Contacts list" })
        .locator("tbody th")
        .allTextContents()
    ).map((s) => s.trim());
  const rows = page.getByRole("region", { name: "Contacts list" }).locator("tbody tr");
  await expect(rows).toHaveCount(25);
  const first = await names();
  // A record inserted at the front between page loads must not shift the next page.
  await seedContact(tenantId, ownerUid, "Aardvark");
  await page.getByRole("link", { name: "Next page" }).click();
  await expect(page).toHaveURL(/cursor=/);
  await expect(rows).toHaveCount(5);
  const second = await names();
  expect(second.filter((n) => first.includes(n))).toEqual([]);
  const all = [...first, ...second].filter((n) => n.startsWith("Page"));
  expect(all).toEqual(Array.from({ length: 28 }, (_, i) => `Page ${String(i).padStart(2, "0")}`));
  // Back on page 1 the fresh first page now includes the new record.
  await page.getByRole("link", { name: "Previous page" }).click();
  await expect(page.getByRole("region", { name: "Contacts list" })).toContainText("Aardvark");
  expect(await names()).toContain("Page 00");
});

test("soft delete → trash → restore (journey 11, TC-REC-001)", async ({ page }) => {
  const id = await seedContact(tenantId, ownerUid, "Trashy");
  await signIn(page, "owner@northwind.test");
  await page.goto(url(`/contacts/${id}`));
  await page.getByRole("button", { name: "Move to trash" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
  await toast(page, "Moved to trash.");
  await expect(page).toHaveURL(url("/contacts"));
  await page.goto(url(`/contacts/${id}`));
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

  await page.goto(url("/trash?type=contact"));
  await page.getByRole("button", { name: "Restore Trashy" }).click();
  await toast(page, "Restored.");
  await page.goto(url(`/contacts/${id}`));
  await expect(page.getByRole("heading", { name: "Trashy" })).toBeVisible();
});

test("Members see only their own records (journey 17, TC-RBAC-004)", async ({ page }) => {
  const rajs = await seedContact(tenantId, rajUid, "Rita Raj");
  const lenas = await seedContact(tenantId, lenaUid, "Leo Lena");
  await signIn(page, "raj@northwind.test");
  await page.goto(url("/contacts"));
  const list = page.getByRole("region", { name: "Contacts list" });
  await expect(list).toContainText("Rita Raj");
  await expect(list).not.toContainText("Leo Lena");
  await expect(
    page.getByLabel("Filter", { exact: true }).locator("option", { hasText: "Owner" }),
  ).toHaveCount(0);

  await page.goto(url(`/contacts/${lenas}`));
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.goto(url(`/contacts/${lenas}/edit`));
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.goto(url(`/contacts/${rajs}`));
  await expect(page.getByRole("heading", { name: "Rita Raj" })).toBeVisible();
  await page.goto(url("/trash"));
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("signed-in app pages ship ≤ 250 KB of gzipped JavaScript on first load (TC-PERF-001)", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Measured once, on Chromium");
  await signIn(page, "owner@northwind.test");
  // page.request shares the signed-in browser context's cookies.
  for (const path of ["/", "/contacts", "/pipeline", "/contacts/new"]) {
    expect(await initialJsBytes(page.request, url(path)), path).toBeLessThanOrEqual(APP_JS_BUDGET);
  }
});
