import { defineConfig, devices } from "@playwright/test";

// E2E against a production build (requirements/09 §7). Viewport matrix per TC-RESP-001.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // Visual baselines are per platform; a missing baseline is written on first run (TC-VIS-001).
  updateSnapshots: "missing",
  expect: { toHaveScreenshot: { animations: "disabled" } },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "chromium-wide",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
    },
    {
      name: "firefox-desktop",
      use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "webkit-desktop",
      use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
    { name: "android", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 800 } } },
    { name: "iphone", use: { ...devices["iPhone 14"] } },
  ],
  // Point E2E_BASE_URL at a deployed environment to skip starting local servers.
  ...(process.env.E2E_BASE_URL ? {} : { webServer: webServers() }),
});

function webServers() {
  const web = {
    command: `pnpm --filter web exec next start -p ${PORT}`,
    url: `${baseURL}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { APP_MARKETING_HOST: `localhost:${PORT}` },
  };
  if (process.env.E2E_EMULATOR !== "1") return web;
  // Emulator runs also start the console app (platform + agency consoles).
  const consolePort = process.env.E2E_CONSOLE_PORT ?? "3200";
  return [
    web,
    {
      command: `pnpm --filter console exec next start -p ${consolePort}`,
      url: `http://console.localhost:${consolePort}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ];
}
