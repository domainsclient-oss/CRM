import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { compareEnvs, parseEnvFile } = await import("./env-parity");

const secret = (s: string) => `${s}-${"x".repeat(40)}`;
const base = (appEnv: string, tag: string) => ({
  APP_ENV: appEnv,
  FIREBASE_PROJECT_ID: `crm-${tag}`,
  CURSOR_SIGNING_SECRET: secret(`cursor-${tag}`),
  CSRF_SECRET: secret(`csrf-${tag}`),
  UNSUBSCRIBE_SIGNING_SECRET: secret(`unsub-${tag}`),
  SESSION_BINDING_SECRET: secret(`bind-${tag}`),
  RATE_LIMIT_BACKEND: "redis",
  SECRETS_BACKEND: "secret-manager",
  RATE_LIMIT_REDIS_URL: `https://${tag}.upstash.io`,
  RATE_LIMIT_REDIS_TOKEN: secret(`redis-${tag}`),
  EMAIL_PROVIDER: "resend",
});

describe("env parity (T-10-01)", () => {
  it("passes for valid, distinct staging and production configs", () => {
    expect(compareEnvs(base("staging", "stg"), base("production", "prd"))).toEqual([]);
  });

  it("reports names only: missing variables, shared secrets, shared projects, invalid configs", () => {
    const staging = { ...base("staging", "stg"), EXTRA_FLAG: "1" };
    const production = {
      ...base("production", "prd"),
      SESSION_BINDING_SECRET: staging.SESSION_BINDING_SECRET,
      FIREBASE_PROJECT_ID: staging.FIREBASE_PROJECT_ID,
      RATE_LIMIT_BACKEND: "memory",
    };
    const problems = compareEnvs(staging, production);
    expect(problems).toContain("missing in production: EXTRA_FLAG");
    expect(problems).toContain("same value in staging and production: SESSION_BINDING_SECRET");
    expect(problems).toContain("staging and production use the same Firebase project");
    expect(problems.some((p) => p.startsWith("production: Invalid server environment"))).toBe(true);
    expect(problems.join("\n")).not.toContain(staging.SESSION_BINDING_SECRET);
  });

  it("parses dotenv files with quotes and comments", () => {
    expect(parseEnvFile("# c\nA=1\nexport B=\"two words\"\nC='x'\nbad line\n")).toEqual({
      A: "1",
      B: "two words",
      C: "x",
    });
  });
});
