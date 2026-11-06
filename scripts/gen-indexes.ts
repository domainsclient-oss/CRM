// Writes firebase/firestore.indexes.json from the query-shape registry (T-03-10, R-04).
// Usage: pnpm indexes:gen            (write)
//        pnpm indexes:gen --check    (exit 1 if the file is out of date; used in CI)
// Deploying indexes is a protected change (requirements/08 §7): review the diff.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { QUERY_SHAPES, needsCompositeIndex } from "../packages/core/src/query-shapes";

interface IndexField {
  fieldPath: string;
  order?: "ASCENDING" | "DESCENDING";
  arrayConfig?: "CONTAINS";
}
interface CompositeIndex {
  collectionGroup: string;
  queryScope: "COLLECTION" | "COLLECTION_GROUP";
  fields: IndexField[];
}

const file = fileURLToPath(new URL("../firebase/firestore.indexes.json", import.meta.url));

export function buildIndexes(): CompositeIndex[] {
  const seen = new Map<string, CompositeIndex>();
  for (const shape of QUERY_SHAPES.filter(needsCompositeIndex)) {
    const fields: IndexField[] = [
      ...shape.equality.map((fieldPath) => ({ fieldPath, order: "ASCENDING" as const })),
      ...(shape.arrayContains
        ? [{ fieldPath: shape.arrayContains, arrayConfig: "CONTAINS" as const }]
        : []),
      ...(shape.orderBy ?? []).map((o) => ({ fieldPath: o.field, order: o.direction })),
    ];
    const index: CompositeIndex = {
      collectionGroup: shape.collection,
      queryScope: shape.scope,
      fields,
    };
    seen.set(JSON.stringify(index), index);
  }
  return [...seen.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function main() {
  const current = JSON.parse(readFileSync(file, "utf8")) as { fieldOverrides?: unknown[] };
  const next = `${JSON.stringify(
    { indexes: buildIndexes(), fieldOverrides: current.fieldOverrides ?? [] },
    null,
    2,
  )}\n`;
  if (process.argv.includes("--check")) {
    if (readFileSync(file, "utf8") !== next) {
      console.error("firestore.indexes.json is out of date — run `pnpm indexes:gen`");
      process.exit(1);
    }
    console.log("firestore.indexes.json is up to date");
    return;
  }
  writeFileSync(file, next);
  console.log(`Wrote ${buildIndexes().length} composite indexes`);
}

main();
