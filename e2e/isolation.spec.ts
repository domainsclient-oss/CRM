import { expect, test } from "@playwright/test";
import {
  addMembership,
  emulatorEnabled,
  resetEmulators,
  seedMember,
  seedWorkspace,
} from "./support/emulator";

// Cross-host session replay (T-09-01 F-03, T-09-02, TC-TEN-007, TC-SEC-001). Session cookies are
// host-only in the browser; these tests copy one to another host on purpose, as an attacker who
// captured it would, and expect it to be useless there — even for a user who is a member of both.
test.skip(!emulatorEnabled(), "requires emulators (pnpm test:e2e:auth)");
test.describe.configure({ mode: "serial" });

const PORT = process.env.E2E_PORT ?? "3100";
const HOST_A = `iso-a.app.localhost:${PORT}`;
const HOST_B = `iso-b.app.localhost:${PORT}`;
const PASSWORD = "correct horse battery staple";
const EMAIL = "both@iso.test";

test.beforeAll(async () => {
  await resetEmulators();
  const a = await seedWorkspace("isoa", HOST_A, "Iso A");
  const b = await seedWorkspace("isob", HOST_B, "Iso B");
  const uid = await seedMember(a.tenantId, EMAIL, PASSWORD, "owner");
  await addMembership(b.tenantId, uid, EMAIL, "owner");
});

test("a session cookie from one workspace host is rejected on another", async ({
  page,
  context,
}) => {
  await page.goto(`http://${HOST_A}/login`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to/ })).toBeVisible();

  const session = (await context.cookies(`http://${HOST_A}`)).find((c) => c.name === "session");
  expect(session?.httpOnly).toBe(true);
  await context.addCookies([
    { ...session!, domain: HOST_B.split(":")[0]!, path: "/", sameSite: "Lax" },
  ]);
  await page.goto(`http://${HOST_B}/`);
  await expect(page).toHaveURL(/\/login$/);

  // The same user signing in on B directly works (membership, not the cookie, grants access).
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to/ })).toBeVisible();
});

test("a workspace cookie replayed on the console is rejected", async ({ page, context }) => {
  const consolePort = process.env.E2E_CONSOLE_PORT ?? "3200";
  await page.goto(`http://${HOST_A}/login`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to/ })).toBeVisible();
  const session = (await context.cookies(`http://${HOST_A}`)).find((c) => c.name === "session");
  await context.addCookies([
    { ...session!, name: "partners", domain: "partners.localhost", path: "/", sameSite: "Lax" },
  ]);
  await page.goto(`http://partners.localhost:${consolePort}/`);
  await expect(page).toHaveURL(/\/login/);
});
