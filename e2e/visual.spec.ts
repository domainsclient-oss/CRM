import { expect, test, type Page } from "@playwright/test";
import {
  emulatorEnabled,
  resetEmulators,
  seedCrmSample,
  seedMember,
  seedWorkspace,
  setDoc,
} from "./support/emulator";

// TC-VIS-001: visual baselines (light, dark, extreme brand colour). Snapshots are per platform
// (Playwright suffixes the OS); missing baselines are written on first run (`updateSnapshots:
// "missing"`), so CI creates its Linux set once and compares from then on.
test.skip(!emulatorEnabled(), "requires emulators (pnpm test:e2e:auth)");
test.describe.configure({ mode: "serial" });

const PORT = process.env.E2E_PORT ?? "3100";
const HOST = `visual.app.localhost:${PORT}`;
const url = (path = "/") => `http://${HOST}${path}`;
const PASSWORD = "correct horse battery staple";
let ids: Awaited<ReturnType<typeof seedCrmSample>>;
let agencyId = "";
let cookies: Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>> | null = null;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: "*{caret-color:transparent!important}" });
}

test.beforeAll(async () => {
  await resetEmulators();
  const ws = await seedWorkspace("visual", HOST, "Visual Co");
  agencyId = ws.agencyId;
  const owner = await seedMember(ws.tenantId, "owner@visual.test", PASSWORD, "owner");
  ids = await seedCrmSample(ws.tenantId, owner);
});

const shots = () => [
  ["login", "/login"],
  ["dashboard", "/"],
  ["contacts", "/contacts"],
  ["deal", `/deals/${ids.dealId}`],
  ["board", "/pipeline"],
];

for (const [theme, brand] of [
  ["light", null],
  ["dark", null],
  ["light", "#FFFF00"], // extreme brand colour: derivation must keep text readable
] as const) {
  test(`visual baselines — ${theme}${brand ? " extreme brand" : ""}`, async ({ page }) => {
    test.setTimeout(120_000);
    if (brand) await setDoc(`agencies/${agencyId}`, { branding: { primaryColor: brand } });
    await page.waitForTimeout(1100); // config cache TTL in E2E
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    if (cookies) await page.context().addCookies(cookies);
    else {
      await page.goto(url("/login"));
      await page.getByLabel("Email").fill("owner@visual.test");
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByRole("heading", { name: /Welcome to/ })).toBeVisible();
      cookies = await page.context().cookies(url());
    }
    for (const [name, path] of shots()) {
      if (name === "login") continue;
      await page.goto(url(path));
      await settle(page);
      await expect(page).toHaveScreenshot(`${name}-${theme}${brand ? "-brand" : ""}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
        mask: [
          page.locator("time"),
          page.locator("[data-sonner-toast]"),
          page.locator('input[type="date"], input[type="time"]'),
        ],
      });
    }
    await page.context().clearCookies();
    await page.goto(url("/login"));
    await settle(page);
    await expect(page).toHaveScreenshot(`login-${theme}${brand ? "-brand" : ""}.png`, {
      maxDiffPixelRatio: 0.02,
    });
  });
}
