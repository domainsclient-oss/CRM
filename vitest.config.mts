import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Workspace self-imports (e.g. @crm/ui/components/x inside packages/ui) and the
// server-only guard need explicit resolution under Vitest.
const alias = [
  { find: "server-only", replacement: r("./test/stubs/server-only.ts") },
  { find: /^@crm\/ui\/components\/(.*)$/, replacement: r("./packages/ui/src/components/$1.tsx") },
  { find: /^@crm\/ui\/lib\/(.*)$/, replacement: r("./packages/ui/src/lib/$1.ts") },
];

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          include: [
            "packages/{core,shared,testing}/src/**/*.test.ts",
            "scripts/**/*.test.ts",
            "firebase/test/indexes.test.ts",
          ],
          // Emulator-backed tests run in the "integration" project only.
          exclude: ["**/node_modules/**", "**/*.int.test.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["packages/ui/src/**/*.test.tsx"],
          setupFiles: [r("./test/setup-dom.ts")],
        },
      },
      // App components: each app resolves "@/" to its own src. Server Actions are mocked per test.
      ...(["web", "console"] as const).map((app) => ({
        plugins: [react()],
        resolve: {
          alias: [{ find: /^@\/(.*)$/, replacement: r(`./apps/${app}/src/$1`) }, ...alias],
        },
        test: {
          name: `dom-${app}`,
          environment: "jsdom",
          include: [`apps/${app}/src/**/*.test.tsx`],
          setupFiles: [r("./test/setup-dom.ts")],
        },
      })),
      {
        resolve: { alias },
        test: {
          // Services and contexts against the Auth + Firestore emulators (`pnpm test:integration`).
          name: "integration",
          environment: "node",
          include: ["packages/**/src/**/*.int.test.ts"],
          setupFiles: [r("./test/setup-integration.ts")],
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
      {
        // Every app's Server Actions, loaded with a test request source in place of
        // `@/server/actions` (registry isolation suite, TC-SEC-002/004).
        resolve: {
          alias: [
            { find: /^@\/server\/actions$/, replacement: r("./test/registry/fake-actions.ts") },
            ...alias,
          ],
        },
        test: {
          name: "registry",
          environment: "node",
          include: ["test/registry/**/*.int.test.ts"],
          setupFiles: [r("./test/setup-integration.ts")],
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
      {
        resolve: { alias },
        test: {
          // Security Rules tests: run only inside the emulators via `pnpm test:rules`.
          name: "rules",
          environment: "node",
          include: ["firebase/test/rules.test.ts"],
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
    // Coverage over unit + component + integration + registry runs (`pnpm test:coverage`, needs the
    // emulators). Thresholds: requirements/09 §10. Next.js routes/pages, the per-app request
    // adapters and async server components that load data are covered by E2E (09 §7), not here.
    coverage: {
      provider: "v8",
      include: [
        "packages/{core,shared,ui}/src/**",
        "apps/*/src/features/**",
        "apps/*/src/components/**",
      ],
      exclude: [
        "**/*.test.*",
        "**/messages/**",
        "**/content/**",
        "packages/core/src/firebase-admin.ts",
        // Async server components / server-only loaders (E2E: crm, data, console specs).
        "apps/web/src/features/records/{data.ts,detail.tsx,timeline.tsx}",
        "apps/web/src/features/data/pending-deletion.tsx",
        "apps/web/src/features/branding/brand-mark.tsx",
        "apps/console/src/components/{console-shell,workspace-overview}.tsx",
      ],
      thresholds: {
        lines: 80,
        branches: 70,
        "packages/core/src/{authz,session,session-http,actions/wrappers,contexts/tenant-context,repositories/base}.ts":
          { lines: 95, branches: 90 },
        "packages/shared/src/{permissions,csv,schemas/**,branding/theme,records/**}.ts": {
          lines: 90,
          branches: 85,
        },
        "packages/core/src/services/**": { lines: 85, branches: 75 },
        "packages/ui/src/**": { lines: 75, branches: 60 },
        "apps/*/src/{features,components}/**": { lines: 60, branches: 50 },
      },
    },
  },
});
