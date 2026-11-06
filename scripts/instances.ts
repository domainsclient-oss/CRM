// Instance registry loader + validation (ADR-019, T-01-11).
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const ENVIRONMENTS = ["dev", "staging", "production"] as const;
export type DeployEnv = (typeof ENVIRONMENTS)[number];

const host = z.string().regex(/^[a-z0-9.-]+$/, "lowercase hostname");
const envSchema = z.object({
  firebaseProjectId: z.string().min(1),
  domains: z.object({ marketing: host, appBase: host, console: host, partners: host }),
});

export const instanceSchema = z.object({
  $comment: z.string().optional(),
  name: z.string().regex(/^[a-z0-9-]+$/),
  region: z.object({ firestore: z.string(), functions: z.string(), vercel: z.string() }),
  defaultCurrency: z.string().length(3),
  environments: z.object({ dev: envSchema, staging: envSchema, production: envSchema }),
  vercel: z.object({ webProjectId: z.string(), consoleProjectId: z.string() }),
});

export type Instance = z.infer<typeof instanceSchema>;

const dir = fileURLToPath(new URL("../instances/", import.meta.url));

export function loadInstances(): Instance[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const parsed = instanceSchema.safeParse(JSON.parse(readFileSync(dir + f, "utf8")));
      if (!parsed.success) throw new Error(`instances/${f}: ${parsed.error.message}`);
      if (`${parsed.data.name}.json` !== f) throw new Error(`instances/${f}: name must match file`);
      return parsed.data;
    });
}

export function isPlaceholder(value: string): boolean {
  return value.startsWith("<") && value.endsWith(">");
}

export function parseDeployEnv(value: string | undefined): DeployEnv {
  const parsed = z.enum(ENVIRONMENTS).safeParse(value);
  if (!parsed.success) throw new Error(`--env must be one of ${ENVIRONMENTS.join(", ")}`);
  return parsed.data;
}

/** Non-secret runtime variables for an instance + environment (requirements/12 §3). */
export function publicConfigFor(instance: Instance, env: DeployEnv): Record<string, string> {
  const e = instance.environments[env];
  return {
    APP_ENV: env,
    APP_INSTANCE: instance.name,
    APP_MARKETING_HOST: e.domains.marketing,
    APP_BASE_DOMAIN: e.domains.appBase,
    APP_CONSOLE_HOST: e.domains.console,
    APP_PARTNERS_HOST: e.domains.partners,
    FIREBASE_PROJECT_ID: e.firebaseProjectId,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: e.firebaseProjectId,
  };
}
