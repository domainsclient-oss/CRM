import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./server-env";

const SECRET = "x".repeat(40);
const local = { FIREBASE_PROJECT_ID: "demo-crm" };
const hosted = {
  APP_ENV: "production",
  FIREBASE_PROJECT_ID: "crm-prod",
  CURSOR_SIGNING_SECRET: SECRET,
  CSRF_SECRET: SECRET,
  UNSUBSCRIBE_SIGNING_SECRET: SECRET,
  SESSION_BINDING_SECRET: SECRET,
  RATE_LIMIT_BACKEND: "redis",
  SECRETS_BACKEND: "secret-manager",
  RATE_LIMIT_REDIS_URL: "https://example-redis.upstash.io",
  RATE_LIMIT_REDIS_TOKEN: "token-value",
  EMAIL_PROVIDER: "postmark",
  LOG_LEVEL: "info",
};

describe("parseServerEnv", () => {
  it("accepts a minimal local environment with safe defaults", () => {
    const env = parseServerEnv(local);
    expect(env.APP_ENV).toBe("local");
    expect(env.APP_SESSION_MAX_AGE_DAYS).toBe(5);
    expect(env.RATE_LIMIT_BACKEND).toBe("memory");
  });

  it("requires the project ID", () => {
    expect(() => parseServerEnv({})).toThrow(/FIREBASE_PROJECT_ID/);
  });

  it("treats empty values as unset", () => {
    const env = parseServerEnv({
      ...local,
      FIREBASE_CLIENT_EMAIL: "",
      FIREBASE_PRIVATE_KEY: "",
      FIRESTORE_EMULATOR_HOST: "",
    });
    expect(env.FIREBASE_CLIENT_EMAIL).toBeUndefined();
    expect(env.FIRESTORE_EMULATOR_HOST).toBeUndefined();
  });

  it("falls back to the public project ID", () => {
    expect(parseServerEnv({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: "crm-dev" }).FIREBASE_PROJECT_ID).toBe(
      "crm-dev",
    );
  });

  it("prefers an explicit server project ID", () => {
    expect(
      parseServerEnv({ FIREBASE_PROJECT_ID: "a", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "b" })
        .FIREBASE_PROJECT_ID,
    ).toBe("a");
  });

  it("rejects half a service-account credential", () => {
    expect(() => parseServerEnv({ ...local, FIREBASE_PRIVATE_KEY: "k" })).toThrow(
      /must be set together/,
    );
  });

  it("caps session lifetime at 14 days (Firebase session cookie maximum)", () => {
    expect(() => parseServerEnv({ ...local, APP_SESSION_MAX_AGE_DAYS: "15" })).toThrow();
  });

  it("accepts a complete production environment", () => {
    expect(parseServerEnv(hosted).APP_ENV).toBe("production");
  });

  it.each([
    ["emulator host", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }, /FIRESTORE_EMULATOR_HOST/],
    ["test flag", { TEST_GATEWAY_MOCKS: "true" }, /TEST_GATEWAY_MOCKS/],
    ["placeholder secret", { CSRF_SECRET: `local-only-change-me-${SECRET}` }, /placeholder/],
    ["short secret", { CSRF_SECRET: "short" }, /at least 32/],
    ["missing secret", { CURSOR_SIGNING_SECRET: undefined }, /CURSOR_SIGNING_SECRET is required/],
    ["in-memory rate limits", { RATE_LIMIT_BACKEND: "memory" }, /RATE_LIMIT_BACKEND/],
    ["console email", { EMAIL_PROVIDER: "console" }, /EMAIL_PROVIDER/],
    [
      "redis without credentials",
      { RATE_LIMIT_REDIS_TOKEN: undefined },
      /RATE_LIMIT_REDIS_URL and RATE_LIMIT_REDIS_TOKEN/,
    ],
    ["plain-http redis", { RATE_LIMIT_REDIS_URL: "http://redis.test" }, /RATE_LIMIT_REDIS_URL/],
    ["debug logging", { LOG_LEVEL: "debug" }, /LOG_LEVEL/],
  ])("rejects %s in production", (_label, override, message) => {
    expect(() => parseServerEnv({ ...hosted, ...override })).toThrow(message);
  });

  it("never echoes secret values in errors", () => {
    const leaky = "super-secret-value-that-must-not-appear";
    try {
      parseServerEnv({ ...hosted, CSRF_SECRET: leaky.slice(0, 10) });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(leaky.slice(0, 10));
    }
  });
});
