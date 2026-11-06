import { expect, test, type Page } from "@playwright/test";
import {
  emulatorEnabled,
  resetEmulators,
  seedCrmSample,
  seedMember,
  seedWorkspace,
} from "./support/emulator";

// TC-A11Y-002 / TC-DEAL-003: journeys completed with the keyboard only — no clicks after sign-in.
// Focus must stay visible and never fall back to <body>.
test.skip(!emulatorEnabled(), "requires emulators (pnpm test:e2e:auth)");
test.describe.configure({ mode: "serial" });

const PORT = process.env.E2E_PORT ?? "3100";
const HOST = `keys.app.localhost:${PORT}`;
const url = (path = "/") => `http://${HOST}${path}`;
const PASSWORD = "correct horse battery staple";
let ids: Awaited<ReturnType<typeof seedCrmSample>>;

/** Tab until the element is focused (bounded), asserting focus never lands on <body>. */
async function tabTo(page: Page, locator: ReturnType<Page["locator"]>, max = 80) {
  const trail: string[] = [];
  for (let i = 0; i < max; i++) {
    if (await locator.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => {
      const el = document.activeElement;
      return el
        ? `${el.tagName}#${el.id}[${el.getAttribute("aria-label") ?? el.textContent?.slice(0, 30) ?? ""}]`
        : "none";
    });
    trail.push(active);
    expect(active.startsWith("BODY"), trail.join(" > ")).toBe(false);
  }
  throw new Error(`element not reachable with Tab: ${trail.join(" > ")}`);
}

test.beforeAll(async () => {
  await resetEmulators();
  const { tenantId } = await seedWorkspace("keys", HOST, "Keys Co");
  const owner = await seedMember(tenantId, "owner@keys.test", PASSWORD, "owner");
  ids = await seedCrmSample(tenantId, owner);
});

test("keyboard-only: sign in, create a contact, move a deal, complete a task", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(url("/login"));
  await tabTo(page, page.getByLabel("Email"));
  await page.keyboard.type("owner@keys.test");
  await page.keyboard.press("Tab");
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /Welcome to/ })).toBeVisible();

  // After client navigation focus is on the page heading (06 §8.2); on a fresh page load the skip
  // link is the first Tab stop.
  await page.goto(url("/"));
  await page.locator("main h1").waitFor();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();

  // Create a contact.
  await page.goto(url("/contacts/new"));
  await page.locator("main h1").waitFor();
  await tabTo(page, page.getByLabel("First name"));
  await page.keyboard.type("Kim");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Keys");
  await tabTo(page, page.getByRole("button", { name: "Save" }));
  const ring = await page.evaluate(
    () =>
      getComputedStyle(document.activeElement!).boxShadow +
      getComputedStyle(document.activeElement!).outlineStyle,
  );
  expect(ring).not.toBe("nonenone"); // visible focus indicator
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Kim Keys" })).toBeVisible();

  // Move a deal with the non-drag control (WCAG 2.5.7).
  await page.goto(url("/pipeline"));
  await page.locator("main h1").waitFor();
  const move = page.getByLabel("Move Sample renewal to stage");
  await tabTo(page, move);
  await page.keyboard.press("ArrowDown"); // Proposal → Negotiation
  await expect(page.locator('[data-stage="stg_negotiation"]')).toContainText("Sample renewal");

  // Complete a task from My tasks with the space bar.
  await page.goto(url("/my-tasks"));
  await page.locator("main h1").waitFor();
  const box = page.getByLabel("Mark Call Sam done");
  await tabTo(page, box);
  await page.keyboard.press("Space");
  await expect(page.getByText("Task completed.")).toBeVisible();

  // Dialogs: Escape closes and focus returns to the trigger.
  await page.goto(url(`/deals/${ids.dealId}`));
  await page.locator("main h1").waitFor();
  const trigger = page.getByRole("button", { name: "Mark lost" });
  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
