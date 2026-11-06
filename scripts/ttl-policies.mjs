// Firestore TTL policies on `expireAt` (requirements/03 §13, T-03-10).
// Usage: node scripts/ttl-policies.mjs --project <id>            (prints commands)
//        node scripts/ttl-policies.mjs --project <id> --apply    (runs gcloud; human approval H4)
// TTL deletes leaf documents asynchronously (typically within ~24 h) and never subcollections.
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

export const TTL_COLLECTION_GROUPS = [
  "invitations",
  "invitationTokens",
  "idempotencyKeys",
  "mailOutbox",
  "privilegedSessions",
  "revocationTokens",
  "auditLogs",
  "platformAuditLogs",
  "notifications",
  "jobs",
  "paymentEvents",
  "contactRequests",
  "tenantTombstones",
];

const { values } = parseArgs({
  options: { project: { type: "string" }, apply: { type: "boolean", default: false } },
});
if (!values.project) throw new Error("--project is required");
if (values.project.startsWith("demo-"))
  throw new Error("TTL policies don't apply to emulator projects");

for (const group of TTL_COLLECTION_GROUPS) {
  const args = [
    "firestore",
    "fields",
    "ttls",
    "update",
    "expireAt",
    `--collection-group=${group}`,
    "--enable-ttl",
    `--project=${values.project}`,
    "--async",
  ];
  console.log(`gcloud ${args.join(" ")}`);
  if (values.apply) {
    const result = spawnSync("gcloud", args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
