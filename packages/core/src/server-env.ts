import "server-only";
import { z } from "zod";

// Server-side environment (T-01-06). Validated once, lazily, so a misconfiguration
// fails loudly on first use. Errors name variables and rules — never values.
// Full variable list: requirements/12-environment-and-configuration.md §3

const HOSTED_ENVS = ["staging", "production"] as const;
const PLACEHOLDER_MARKERS = ["change-me", "<", "placeholder"];

const optionalString = z.string().min(1).optional();
const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const serverEnvSchema = z
  .object({
    APP_ENV: z.enum(["local", "test", "dev", "staging", "production"]).default("local"),
    APP_INSTANCE: z.string().min(1).default("local"),
    APP_MARKETING_HOST: optionalString,
    APP_BASE_DOMAIN: optionalString,
    APP_CONSOLE_HOST: optionalString,
    APP_PARTNERS_HOST: optionalString,
    APP_PLATFORM_STAFF_DOMAINS: optionalString,

    APP_SESSION_COOKIE_NAME: z.string().min(1).default("session"),
    APP_SESSION_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(14).default(5),
    APP_REAUTH_WINDOW_SECONDS: positiveInt(300),
    APP_TENANT_CACHE_TTL_SECONDS: positiveInt(60),

    FIREBASE_PROJECT_ID: z.string().min(1),
    FIREBASE_CLIENT_EMAIL: z.email().optional(),
    FIREBASE_PRIVATE_KEY: optionalString,
    FIRESTORE_EMULATOR_HOST: optionalString,
    /** Operator tooling only (restore drills): point the server code at a restored database. */
    FIRESTORE_DATABASE_ID: z.string().min(1).default("(default)"),
    FIREBASE_AUTH_EMULATOR_HOST: optionalString,
    FIREBASE_STORAGE_EMULATOR_HOST: optionalString,
    /** Public brand assets (logos, favicons); private by IAM, served via /api/brand. */
    FIREBASE_STORAGE_BRAND_BUCKET: optionalString,
    /** Private files: imports, exports, error reports (never public). */
    FIREBASE_STORAGE_PRIVATE_BUCKET: optionalString,
    /** Background jobs: "inline" runs job bodies in-process (local/test); "functions" leaves them to Cloud Functions. */
    JOBS_MODE: z.enum(["inline", "functions"]).optional(),

    CURSOR_SIGNING_SECRET: optionalString,
    CSRF_SECRET: optionalString,
    UNSUBSCRIBE_SIGNING_SECRET: optionalString,
    /** HMAC key binding session cookies to their surface + host (T-09-01 F-03). */
    SESSION_BINDING_SECRET: optionalString,

    RATE_LIMIT_BACKEND: z.enum(["memory", "redis"]).default("memory"),
    /** Per-agency gateway secrets: Google Secret Manager, or the emulator-only local store. */
    SECRETS_BACKEND: z.enum(["local", "secret-manager"]).default("local"),
    /** Upstash Redis REST endpoint + token (ADR-013); required when RATE_LIMIT_BACKEND=redis. */
    RATE_LIMIT_REDIS_URL: z.url({ protocol: /^https$/ }).optional(),
    RATE_LIMIT_REDIS_TOKEN: optionalString,
    EMAIL_PROVIDER: z.enum(["console", "postmark", "resend", "sendgrid", "ses"]).default("console"),
    EMAIL_FROM_ADDRESS: z.email().default("no-reply@mail.example.com"),
    EMAIL_PROVIDER_API_KEY: optionalString,
    /** Domain provider for custom domains: Vercel Domains API, or a deterministic mock. */
    VERCEL_API_TOKEN: optionalString,
    VERCEL_PROJECT_ID_WEB: optionalString,
    VERCEL_TEAM_ID: optionalString,
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    TEST_FAULT_INJECTION: optionalString,
    TEST_GATEWAY_MOCKS: optionalString,
    TEST_VERCEL_DOMAINS_MOCK: optionalString,
    /** E2E only: multiply rate limits (many sign-ins from one IP in a test run). */
    TEST_RATE_LIMIT_SCALE: optionalString,
  })
  .superRefine((env, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    const hosted = (HOSTED_ENVS as readonly string[]).includes(env.APP_ENV);

    if (Boolean(env.FIREBASE_CLIENT_EMAIL) !== Boolean(env.FIREBASE_PRIVATE_KEY)) {
      issue("FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must be set together");
    }
    if (
      env.RATE_LIMIT_BACKEND === "redis" &&
      (!env.RATE_LIMIT_REDIS_URL || !env.RATE_LIMIT_REDIS_TOKEN)
    ) {
      issue(
        "RATE_LIMIT_REDIS_URL and RATE_LIMIT_REDIS_TOKEN are required when RATE_LIMIT_BACKEND=redis",
      );
    }
    if (!hosted) return;

    for (const name of [
      "FIRESTORE_EMULATOR_HOST",
      "FIREBASE_AUTH_EMULATOR_HOST",
      "FIREBASE_STORAGE_EMULATOR_HOST",
    ] as const) {
      if (env[name]) issue(`${name} must not be set in ${env.APP_ENV}`);
    }
    for (const name of [
      "TEST_FAULT_INJECTION",
      "TEST_GATEWAY_MOCKS",
      "TEST_VERCEL_DOMAINS_MOCK",
      "TEST_RATE_LIMIT_SCALE",
    ] as const) {
      if (env[name] && env[name] !== "false")
        issue(`${name} must not be enabled in ${env.APP_ENV}`);
    }
    for (const name of [
      "CURSOR_SIGNING_SECRET",
      "CSRF_SECRET",
      "UNSUBSCRIBE_SIGNING_SECRET",
      "SESSION_BINDING_SECRET",
    ] as const) {
      const value = env[name];
      if (!value) issue(`${name} is required in ${env.APP_ENV}`);
      else if (value.length < 32) issue(`${name} must be at least 32 characters`);
      else if (PLACEHOLDER_MARKERS.some((marker) => value.includes(marker))) {
        issue(`${name} still contains a placeholder value`);
      }
    }
    if (env.SECRETS_BACKEND === "local")
      issue(`SECRETS_BACKEND=local is not allowed in ${env.APP_ENV}`);
    if (env.RATE_LIMIT_BACKEND === "memory")
      issue(`RATE_LIMIT_BACKEND=memory is not allowed in ${env.APP_ENV}`);
    if (env.EMAIL_PROVIDER === "console")
      issue(`EMAIL_PROVIDER=console is not allowed in ${env.APP_ENV}`);
    if (env.APP_ENV === "production" && env.LOG_LEVEL === "debug") {
      issue("LOG_LEVEL=debug is not allowed in production");
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Parse an arbitrary env record. Exported for tests; app code uses getServerEnv(). */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  // Empty values mean "unset" (lets a shell override a .env file entry with nothing).
  const defined = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  // The server project ID always equals the public one; avoid configuring it twice.
  const withDefaults = {
    ...defined,
    FIREBASE_PROJECT_ID: defined.FIREBASE_PROJECT_ID || defined.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  };
  const parsed = serverEnvSchema.safeParse(withDefaults);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; ");
    throw new Error(`Invalid server environment: ${issues}`);
  }
  return parsed.data;
}

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
