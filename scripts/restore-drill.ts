// Restore drill (T-10-04, 10 §9, NFR-REL-002): run AFTER restoring a backup into a new database.
// 1. compares the restored database with the source (counts per tenant/collection + sample checksums)
// 2. re-applies erasures logged after the backup time (R-09) to the restored database
// 3. prints a JSON report with timings for the drill record.
//
// Usage (staging, operator credentials via ADC):
//   FIRESTORE_DATABASE_ID=<restored db> pnpm restore:drill --source "(default)" \
//     --backup-time 2026-11-03T02:00:00Z [--sample 20] [--dry-run]
// Never run with FIRESTORE_DATABASE_ID pointing at a live production database.
import { parseArgs } from "node:util";
import { getDb, getNamedDb } from "../packages/core/src/firebase-admin";
import { reapplyErasures } from "../packages/core/src/privacy";
import { compareDatabases } from "../packages/core/src/restore";

const { values } = parseArgs({
  options: {
    source: { type: "string", default: "(default)" },
    "backup-time": { type: "string" },
    sample: { type: "string", default: "20" },
    "dry-run": { type: "boolean", default: false },
  },
});

async function main() {
  const restoredId = process.env.FIRESTORE_DATABASE_ID;
  const backupTime = values["backup-time"] ? new Date(values["backup-time"]) : null;
  if (!restoredId || restoredId === values.source) {
    throw new Error("Set FIRESTORE_DATABASE_ID to the restored database (not the source)");
  }
  if (!backupTime || Number.isNaN(backupTime.getTime())) throw new Error("--backup-time required");

  const started = Date.now();
  const comparison = await compareDatabases(getNamedDb(values.source!), getDb(), {
    sample: Number(values.sample),
  });
  const erasures = await reapplyErasures(backupTime, {
    dryRun: values["dry-run"],
    requestId: "restore-drill",
  });
  const report = {
    restoredDatabase: restoredId,
    sourceDatabase: values.source,
    backupTime: backupTime.toISOString(),
    comparison,
    erasures,
    dryRun: values["dry-run"],
    totalMs: Date.now() - started,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
