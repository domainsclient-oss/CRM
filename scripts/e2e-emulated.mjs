// Browser E2E against the Firebase emulators (auth + firestore).
// Usage: pnpm test:e2e:auth  (wraps this in `firebase emulators:exec`)
// Builds the web app with demo-project config so nothing can reach a real Firebase project.
import { spawnSync } from "node:child_process";

for (const name of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"]) {
  if (!process.env[name]) throw new Error(`${name} missing — run via pnpm test:e2e:auth`);
}

const PORT = process.env.E2E_PORT ?? "3100";
const CONSOLE_PORT = process.env.E2E_CONSOLE_PORT ?? "3200";
const env = {
  ...process.env,
  E2E_EMULATOR: "1",
  E2E_PORT: PORT,
  APP_ENV: "test",
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-crm.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-crm",
  NEXT_PUBLIC_FIREBASE_APP_ID: "demo-app-id",
  NEXT_PUBLIC_USE_AUTH_EMULATOR: "true",
  FIREBASE_PROJECT_ID: "demo-crm",
  // Override any real credentials from .env.local (empty = unset).
  FIREBASE_CLIENT_EMAIL: "",
  FIREBASE_PRIVATE_KEY: "",
  GOOGLE_APPLICATION_CREDENTIALS: "",
  APP_MARKETING_HOST: `localhost:${PORT}`,
  APP_BASE_DOMAIN: `app.localhost:${PORT}`,
  APP_CONSOLE_HOST: `console.localhost:${CONSOLE_PORT}`,
  APP_PARTNERS_HOST: `partners.localhost:${CONSOLE_PORT}`,
  APP_PLATFORM_STAFF_DOMAINS: "example.com",
  E2E_CONSOLE_PORT: CONSOLE_PORT,
  EMAIL_PROVIDER: "console",
  RATE_LIMIT_BACKEND: "memory",
  LOG_LEVEL: "warn",
  // Phase 5: brand assets in the storage emulator, mocked domain provider, fast config refresh.
  FIREBASE_STORAGE_BRAND_BUCKET: "demo-crm-brand-assets",
  FIREBASE_STORAGE_PRIVATE_BUCKET: "demo-crm-private",
  TEST_VERCEL_DOMAINS_MOCK: "true",
  APP_TENANT_CACHE_TTL_SECONDS: "1",
  TEST_RATE_LIMIT_SCALE: "10",
  // Phase 6b: deterministic payment gateway; secrets in the emulator.
  TEST_GATEWAY_MOCKS: "true",
};

function run(command) {
  const result = spawnSync(command, { stdio: "inherit", env, shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("pnpm --filter web build");
run("pnpm --filter console build");
run(
  `pnpm exec playwright test --workers=1 --project=chromium-desktop e2e/auth.spec.ts e2e/console.spec.ts e2e/crm.spec.ts e2e/branding.spec.ts e2e/data.spec.ts e2e/a11y.spec.ts e2e/keyboard.spec.ts e2e/visual.spec.ts e2e/isolation.spec.ts e2e/billing.spec.ts ${process.argv.slice(2).join(" ")}`,
);
// Viewport matrix (TC-RESP-001): phone, tablet, desktop.
run(
  "pnpm exec playwright test --workers=1 --project=android --project=tablet --project=chromium-desktop e2e/responsive.spec.ts",
);
