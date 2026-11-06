// Staging ↔ production configuration parity (T-10-01). Compares two env files (e.g. from
// `vercel env pull --environment=preview|production`) and prints variable NAMES only — never values.
//
// Checks: each file passes the hosted-environment validation for its APP_ENV; both define the same
// variables (except allowed per-env ones); no secret has the same value in both (shared secrets
// let a staging leak forge production sessions or cursors).
// Usage: pnpm env:parity --staging .env.staging.local --production .env.production.local
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseServerEnv } from "../packages/core/src/server-env";

const SECRETS = [
  "CURSOR_SIGNING_SECRET",
  "CSRF_SECRET",
  "UNSUBSCRIBE_SIGNING_SECRET",
  "SESSION_BINDING_SECRET",
  "RATE_LIMIT_REDIS_TOKEN",
  "FIREBASE_PRIVATE_KEY",
  "VERCEL_API_TOKEN",
  "EMAIL_PROVIDER_API_KEY",
];
/** Expected to exist in one environment only. */
const PER_ENV = new Set(["VERCEL_ENV", "VERCEL_URL", "VERCEL_GIT_COMMIT_SHA"]);

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2]!;
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1).replace(/\\n/g, "\n");
    out[m[1]!] = value;
  }
  return out;
}

export function compareEnvs(staging: Record<string, string>, production: Record<string, string>) {
  const problems: string[] = [];
  for (const [label, env, expected] of [
    ["staging", staging, "staging"],
    ["production", production, "production"],
  ] as const) {
    if (env.APP_ENV !== expected) problems.push(`${label}: APP_ENV must be "${expected}"`);
    try {
      parseServerEnv(env);
    } catch (error) {
      problems.push(`${label}: ${(error as Error).message}`);
    }
  }
  const names = new Set([...Object.keys(staging), ...Object.keys(production)]);
  for (const name of [...names].sort()) {
    if (PER_ENV.has(name)) continue;
    if (!(name in staging)) problems.push(`missing in staging: ${name}`);
    if (!(name in production)) problems.push(`missing in production: ${name}`);
  }
  for (const name of SECRETS) {
    if (staging[name] && staging[name] === production[name]) {
      problems.push(`same value in staging and production: ${name}`);
    }
  }
  if (
    staging.FIREBASE_PROJECT_ID &&
    staging.FIREBASE_PROJECT_ID === production.FIREBASE_PROJECT_ID
  ) {
    problems.push("staging and production use the same Firebase project");
  }
  return problems;
}

if (process.argv[1]?.endsWith("env-parity.ts")) {
  const { values } = parseArgs({
    options: { staging: { type: "string" }, production: { type: "string" } },
  });
  if (!values.staging || !values.production) {
    console.error("Required: --staging <file> --production <file>");
    process.exit(2);
  }
  const problems = compareEnvs(
    parseEnvFile(readFileSync(values.staging, "utf8")),
    parseEnvFile(readFileSync(values.production, "utf8")),
  );
  if (problems.length) {
    console.error(`Parity problems (${problems.length}):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("Staging and production configuration are in parity.");
}
