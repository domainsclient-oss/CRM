import "server-only";
import { createHash } from "node:crypto";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { TENANT_COLLECTIONS } from "./repositories/base";

// Restore verification (10 §9 restore drill, T-10-04): compare a restored database with its source
// per tenant and collection — document counts plus checksums of a sample of documents. Reports
// numbers and IDs only, never document contents.

export interface CollectionDiff {
  tenantId: string;
  collection: string;
  source: number;
  restored: number;
  sampled: number;
  checksumMismatches: string[];
}

export interface RestoreReport {
  tenants: number;
  collections: number;
  countMismatches: CollectionDiff[];
  checksumMismatches: CollectionDiff[];
  durationMs: number;
}

/** Stable JSON (sorted keys) so equal documents hash equally across databases. */
function canonical(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return { $ts: (value as { toMillis: () => number }).toMillis() };
  }
  if (typeof (value as { path?: unknown }).path === "string" && "firestore" in (value as object)) {
    return { $ref: (value as { path: string }).path };
  }
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
  );
}

export const checksum = (data: DocumentData | undefined) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(data ?? null)))
    .digest("hex");

export async function compareDatabases(
  source: Firestore,
  restored: Firestore,
  opts: { sample?: number; tenantIds?: string[] } = {},
): Promise<RestoreReport> {
  const started = Date.now();
  const sample = opts.sample ?? 20;
  const tenantIds =
    opts.tenantIds ?? (await source.collection("tenants").listDocuments()).map((d) => d.id);
  const countMismatches: CollectionDiff[] = [];
  const checksumMismatches: CollectionDiff[] = [];
  let collections = 0;

  for (const tenantId of tenantIds) {
    for (const collection of ["", ...TENANT_COLLECTIONS]) {
      collections++;
      const path = collection ? `tenants/${tenantId}/${collection}` : null;
      if (!path) {
        const [a, b] = await Promise.all([
          source.doc(`tenants/${tenantId}`).get(),
          restored.doc(`tenants/${tenantId}`).get(),
        ]);
        if (checksum(a.data()) !== checksum(b.data())) {
          checksumMismatches.push({
            tenantId,
            collection: "(tenant)",
            source: a.exists ? 1 : 0,
            restored: b.exists ? 1 : 0,
            sampled: 1,
            checksumMismatches: [tenantId],
          });
        }
        continue;
      }
      const [sourceCount, restoredCount] = await Promise.all([
        source.collection(path).count().get(),
        restored.collection(path).count().get(),
      ]);
      const diff: CollectionDiff = {
        tenantId,
        collection,
        source: sourceCount.data().count,
        restored: restoredCount.data().count,
        sampled: 0,
        checksumMismatches: [],
      };
      if (diff.source !== diff.restored) countMismatches.push(diff);
      if (diff.source === 0) continue;
      const docs = await source.collection(path).limit(sample).get();
      const copies = await restored.getAll(...docs.docs.map((d) => restored.doc(d.ref.path)));
      diff.sampled = docs.size;
      docs.docs.forEach((d, i) => {
        if (checksum(d.data()) !== checksum(copies[i]?.data())) diff.checksumMismatches.push(d.id);
      });
      if (diff.checksumMismatches.length > 0) checksumMismatches.push(diff);
    }
  }
  return {
    tenants: tenantIds.length,
    collections,
    countMismatches,
    checksumMismatches,
    durationMs: Date.now() - started,
  };
}
