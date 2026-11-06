import "server-only";
import { buildSearchTokens, foldText } from "@crm/shared/records/normalize";
import { authorize } from "../authz";
import type { TenantContext } from "../contexts/tenant-context";
import { getDb } from "../firebase-admin";
import { registerJobHandler, enqueueJob, jobsRunInline, runJob } from "../jobs/runner";
import { enforceRateLimit } from "../rate-limit";
import { scopedQuery, tenantCollection } from "../repositories/base";
import { recordLabel } from "./common";

// Global search (FR-SRCH-001, ADR-010): word-prefix matching on precomputed tokens. One indexed
// array-contains query per entity on the longest query word, remaining words filtered in memory
// over a small candidate set. Same tenant, non-deleted, and own-scoped for Members (via
// scopedQuery). Rate-limited per user.

export const SEARCH_ENTITIES = ["contacts", "companies", "leads", "deals"] as const;
type SearchEntity = (typeof SEARCH_ENTITIES)[number];

const NAME_FIELD: Record<SearchEntity, string> = {
  contacts: "fullNameLower",
  companies: "nameLower",
  leads: "fullNameLower",
  deals: "nameLower",
};
const TYPE: Record<SearchEntity, "contact" | "company" | "lead" | "deal"> = {
  contacts: "contact",
  companies: "company",
  leads: "lead",
  deals: "deal",
};

export interface SearchHit {
  entity: SearchEntity;
  id: string;
  label: string;
  detail: string | null;
}

export const SEARCH_POLICY = { name: "search:uid", limit: 60, windowSeconds: 60 };

export function searchWords(query: string): string[] {
  return [
    ...new Set(
      foldText(query)
        .split(/[\s@._\-/,;:()'"]+/)
        .filter((w) => w.length >= 2),
    ),
  ].map((w) => w.slice(0, 15));
}

export async function globalSearch(
  ctx: TenantContext,
  query: string,
): Promise<Record<SearchEntity, SearchHit[]>> {
  authorize(ctx, "record.read");
  await enforceRateLimit(SEARCH_POLICY, ctx.uid);
  const words = searchWords(query.slice(0, 100));
  const empty = { contacts: [], companies: [], leads: [], deals: [] } as Record<
    SearchEntity,
    SearchHit[]
  >;
  if (words.length === 0) return empty;
  const primary = [...words].sort((a, b) => b.length - a.length)[0]!;
  const rest = words.filter((w) => w !== primary);
  const results = await Promise.all(
    SEARCH_ENTITIES.map(async (entity) => {
      const snap = await scopedQuery(ctx, entity)
        .where("searchTokens", "array-contains", primary)
        .orderBy(NAME_FIELD[entity], "asc")
        .limit(25)
        .get();
      const hits = snap.docs
        .filter((d) => {
          const tokens = new Set((d.get("searchTokens") as string[] | undefined) ?? []);
          return rest.every((w) => tokens.has(w));
        })
        .slice(0, 5)
        .map((d): SearchHit => ({
          entity,
          id: d.id,
          label: recordLabel(TYPE[entity], d.data()),
          detail:
            (d.get("email") as string | null) ??
            (d.get("domain") as string | null) ??
            (d.get("companyName") as string | null) ??
            null,
        }));
      return [entity, hits] as const;
    }),
  );
  return Object.fromEntries(results) as Record<SearchEntity, SearchHit[]>;
}

/** Recompute tokens for every record (after tokenizer changes or legacy data) — idempotent. */
export async function requestSearchBackfill(ctx: TenantContext) {
  authorize(ctx, "settings.manage");
  const { jobId } = await enqueueJob(ctx, "searchBackfill", {}, "Search index rebuild");
  if (jobsRunInline()) await runJob(ctx.tenantId, jobId);
  return { jobId };
}

function tokensFor(entity: SearchEntity, d: FirebaseFirestore.DocumentData): string[] {
  switch (entity) {
    case "contacts":
    case "leads":
      return buildSearchTokens([d.firstName, d.lastName, d.email, d.companyName]);
    case "companies":
      return buildSearchTokens([d.name, d.domain]);
    case "deals":
      return buildSearchTokens([d.name, d.companyName]);
  }
}

registerJobHandler("searchBackfill", async (job) => {
  let processed = 0;
  for (const entity of SEARCH_ENTITIES) {
    let query = tenantCollection({ tenantId: job.tenantId }, entity).orderBy("__name__").limit(400);
    for (;;) {
      const snap = await query.get();
      const batch = getDb().batch();
      for (const d of snap.docs) batch.update(d.ref, { searchTokens: tokensFor(entity, d.data()) });
      if (snap.size > 0) await batch.commit();
      processed += snap.size;
      await job.checkpoint({ progress: { total: processed, processed, failed: 0 } });
      const last = snap.docs.at(-1);
      if (snap.size < 400 || !last) break;
      query = tenantCollection({ tenantId: job.tenantId }, entity)
        .orderBy("__name__")
        .startAfter(last.id)
        .limit(400);
    }
  }
  return { status: "succeeded" };
});
