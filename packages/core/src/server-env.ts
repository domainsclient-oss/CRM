import "server-only";
import { z } from "zod";

// Server-side environment for Firebase Admin. Validated once, lazily, so a
// misconfiguration fails loudly on first use instead of at import time.
// Full variable list: requirements/12-environment-and-configuration.md §3
const serverEnvSchema = z
  .object({
    APP_ENV: z.enum(["local", "test", "dev", "staging", "production"]).default("local"),
    FIREBASE_PROJECT_ID: z.string().min(1),
    FIREBASE_CLIENT_EMAIL: z.email().optional(),
    FIREBASE_PRIVATE_KEY: z.string().min(1).optional(),
    FIRESTORE_EMULATOR_HOST: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.FIREBASE_CLIENT_EMAIL) !== Boolean(env.FIREBASE_PRIVATE_KEY)) {
      ctx.addIssue({
        code: "custom",
        message: "FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must be set together",
      });
    }
    if (env.FIRESTORE_EMULATOR_HOST && ["staging", "production"].includes(env.APP_ENV)) {
      ctx.addIssue({
        code: "custom",
        message: "FIRESTORE_EMULATOR_HOST must not be set in staging or production",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Report variable names and rules only — never values.
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server environment: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
