// Sync non-secret config from the instance registry to Vercel env vars (requirements/10 §4).
// Usage: pnpm env:sync --instance shared-us --env staging --dry-run
// Secrets are never handled here; they are set as Vercel sensitive vars / Secret Manager.
import { parseArgs } from "node:util";
import { isPlaceholder, loadInstances, parseDeployEnv, publicConfigFor } from "./instances";

const { values } = parseArgs({
  options: {
    instance: { type: "string" },
    env: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const instance = loadInstances().find((i) => i.name === values.instance);
if (!instance) throw new Error(`Unknown --instance "${values.instance ?? ""}" (see instances/)`);
const env = parseDeployEnv(values.env);
const config = publicConfigFor(instance, env);

const placeholders = Object.entries(config).filter(([, v]) => isPlaceholder(v));
for (const [name, value] of Object.entries(config)) console.log(`${name}=${value}`);

if (values["dry-run"]) {
  if (placeholders.length) {
    console.warn(
      `\n${placeholders.length} placeholder value(s) — fill instances/${instance.name}.json first.`,
    );
  }
  process.exit(0);
}

if (placeholders.length) throw new Error("Refusing to sync placeholder values.");
// Writing to Vercel is enabled once T-01-09 verifies the Vercel API/CLI flow and token scope.
throw new Error("Live sync not enabled yet (pending T-01-09). Use --dry-run.");
