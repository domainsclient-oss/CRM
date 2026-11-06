// Prints the Server Action IDs of a web build as JSON ({ exportedName: id }) for the k6 load test,
// which calls actions the way the browser does (POST with a `Next-Action` header).
// Usage: pnpm --filter web build && node scripts/k6-actions.mjs > load/actions.json
import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync("apps/web/.next/server/server-reference-manifest.json", "utf8"),
);
const ids = {};
for (const [id, entry] of Object.entries(manifest.node ?? {})) ids[entry.exportedName] = id;
process.stdout.write(`${JSON.stringify(ids, null, 2)}\n`);
