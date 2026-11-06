// Lighthouse budgets for public pages (requirements/07 §6, T-08-05):
// performance ≥ 90, SEO ≥ 95, best practices ≥ 95, accessibility = 100.
//
// Usage: pnpm build && pnpm perf:lighthouse [baseUrl]
//   baseUrl defaults to a local `next start` on :3100 (started and stopped by this script).
// Lighthouse is fetched on demand with `pnpm dlx` (kept out of the lockfile: it pulls in
// dev-only advisories) and runs against Playwright's Chromium.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const PAGES = process.env.LH_PAGES
  ? process.env.LH_PAGES.split(",")
  : ["/", "/features", "/plans", "/docs", "/docs/import-contacts-csv", "/faq", "/contact"];
const MIN = { performance: 0.9, seo: 0.95, "best-practices": 0.95, accessibility: 1 };
const LIGHTHOUSE = "lighthouse@12.8.2";

const external = process.argv[2];
const port = 3100;
const base = external ?? `http://localhost:${port}`;
const shell = process.platform === "win32";

async function waitFor(url, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start: ${url}`);
}

let server;
if (!external) {
  server = spawn("pnpm", ["--filter", "web", "exec", "next", "start", "-p", String(port)], {
    env: { ...process.env, APP_MARKETING_HOST: `localhost:${port}` },
    stdio: "ignore",
    shell,
  });
  await waitFor(`${base}/`);
}

const out = mkdtempSync(join(tmpdir(), "lh-"));
const RUNS = 3; // median of three: single Lighthouse runs vary by several points
const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
// With a shell (Windows), arguments are concatenated, so quote the one containing a space.
const chromeFlags = "--headless=new --no-sandbox";

function lighthouse(url, file) {
  const run = spawnSync(
    "pnpm",
    [
      "dlx",
      LIGHTHOUSE,
      url,
      "--quiet",
      "--output=json",
      `--output-path=${file}`,
      "--only-categories=performance,seo,best-practices,accessibility",
      shell ? `--chrome-flags="${chromeFlags}"` : `--chrome-flags=${chromeFlags}`,
    ],
    { env: { ...process.env, CHROME_PATH: chromium.executablePath() }, stdio: "inherit", shell },
  );
  if (run.status !== 0) return null;
  const { categories, audits } = JSON.parse(readFileSync(file, "utf8"));
  if (process.env.LH_VERBOSE) {
    const metrics = ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time"];
    console.log(url, metrics.map((k) => `${k}=${audits[k].displayValue}`).join(" "));
  }
  return Object.fromEntries(Object.keys(MIN).map((k) => [k, categories[k].score]));
}

const failures = [];
try {
  for (const path of PAGES) {
    const results = [];
    // Up to two extra attempts for Lighthouse's own trace errors (e.g. NO_NAVSTART).
    for (let attempt = 0; results.length < RUNS && attempt < RUNS + 2; attempt++) {
      const file = join(out, `${path.replace(/\W+/g, "_") || "home"}-${attempt}.json`);
      const scores = lighthouse(`${base}${path}`, file);
      if (scores) results.push(scores);
    }
    if (results.length < RUNS) {
      failures.push(`${path}: only ${results.length}/${RUNS} Lighthouse runs completed`);
      continue;
    }
    const scores = Object.fromEntries(
      Object.keys(MIN).map((k) => [k, median(results.map((r) => r[k]))]),
    );
    console.log(path, JSON.stringify(scores));
    for (const [k, min] of Object.entries(MIN)) {
      if (scores[k] < min) failures.push(`${path}: ${k} ${scores[k]} < ${min}`);
    }
  }
} finally {
  if (server) {
    if (shell) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else server.kill();
  }
}

if (failures.length) {
  console.error(`\nLighthouse budgets failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nLighthouse budgets met.");
