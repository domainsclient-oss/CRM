// UAT environment (T-10-02): provision a pilot agency and its client workspaces on STAGING through
// the real services (owners get invitations; custom/agency domains start in pending DNS).
//
// Usage (operator credentials via ADC, staging project):
//   pnpm uat:seed --config uat/pilot.json --project <staging project id> --operator-uid <your uid>
// Refuses production, and refuses unless --project matches the configured project.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { logger } from "../packages/core/src/logger";
import { provisionPilot } from "../packages/core/src/pilot";
import { getServerEnv } from "../packages/core/src/server-env";

const { values } = parseArgs({
  options: {
    config: { type: "string" },
    project: { type: "string" },
    "operator-uid": { type: "string" },
  },
});

async function main() {
  const env = getServerEnv();
  if (env.APP_ENV === "production") throw new Error("UAT seeding is never run against production");
  if (!values.config || !values.project || !values["operator-uid"]) {
    throw new Error("Required: --config --project --operator-uid");
  }
  if (values.project !== env.FIREBASE_PROJECT_ID) {
    throw new Error(`--project ${values.project} doesn't match FIREBASE_PROJECT_ID`);
  }
  const uid = values["operator-uid"];
  const result = await provisionPilot(
    {
      uid,
      role: "superadmin",
      session: {
        uid,
        email: null,
        emailVerified: true,
        authTime: Math.floor(Date.now() / 1000),
        signInProvider: "google.com",
      },
      requestId: "uat-seed",
      log: logger,
    },
    JSON.parse(readFileSync(values.config, "utf8")),
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
