import { z } from "zod";

// Public (browser-visible) configuration. Only these NEXT_PUBLIC_* names are allowed
// (requirements/12 §2). Each variable must be referenced literally — Next.js inlines
// process.env.NEXT_PUBLIC_* at build time and cannot see dynamic lookups.
const publicEnvSchema = z.object({
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().min(1),
  NEXT_PUBLIC_USE_AUTH_EMULATOR: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export const PUBLIC_ENV_NAMES = Object.keys(publicEnvSchema.shape);

let cached: PublicEnv | undefined;

export function getPublicEnv(): PublicEnv {
  if (cached) return cached;
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    NEXT_PUBLIC_USE_AUTH_EMULATOR: process.env.NEXT_PUBLIC_USE_AUTH_EMULATOR,
  });
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid public environment: ${names}`);
  }
  cached = parsed.data;
  return cached;
}
