import "server-only";
import { buildSearchTokens, foldText, normalizeDomain } from "@crm/shared/records/normalize";
import type { CompanyInput } from "@crm/shared/records/schemas";
import type { TenantContext } from "../contexts/tenant-context";
import { getById, tenantCollection } from "../repositories/base";
import { canReadRecord } from "../repositories/base";
import { toPlain } from "./plain";
import { saveRecord, type SaveTarget } from "./save";

// Companies (FR-COM-001..003).

function fields(input: CompanyInput) {
  const domainNormalized = input.domain ? normalizeDomain(input.domain) : null;
  return {
    name: input.name,
    nameLower: foldText(input.name),
    domain: domainNormalized,
    domainNormalized,
    industry: input.industry,
    sizeBand: input.sizeBand,
    phone: input.phone,
    website: input.website,
    address: input.address,
    description: input.description,
    searchTokens: buildSearchTokens([input.name, domainNormalized]),
  };
}

export function saveCompany(ctx: TenantContext, target: SaveTarget, input: CompanyInput) {
  return saveRecord(ctx, "company", target, async (_tx, existing) => ({
    fields: { ...fields(input), ...(existing ? {} : { counts: { contacts: 0, openDeals: 0 } }) },
    owner: input.ownerUid,
    tags: input.tags,
  }));
}

export async function getCompany(ctx: TenantContext, id: string) {
  const doc = await getById(ctx, "companies", id);
  return toPlain(doc) as Record<string, unknown> & { id: string; updatedAt: string };
}

export type DuplicateResult =
  { status: "none" } | { status: "visible"; id: string; label: string } | { status: "hidden" };

/**
 * FR-COM-003 / FR-RBAC-004 AC4: same-tenant, non-deleted match on the normalized domain.
 * A Member who can't see the match learns only that one exists.
 */
export async function findDuplicateCompany(
  ctx: TenantContext,
  domain: string,
  excludeId: string | null,
): Promise<DuplicateResult> {
  const normalized = normalizeDomain(domain);
  if (!normalized) return { status: "none" };
  const snap = await tenantCollection(ctx, "companies")
    .where("isDeleted", "==", false)
    .where("domainNormalized", "==", normalized)
    .limit(2)
    .get();
  const match = snap.docs.find((d) => d.id !== excludeId);
  if (!match) return { status: "none" };
  return canReadRecord(ctx, "companies", match.data())
    ? { status: "visible", id: match.id, label: String(match.get("name")) }
    : { status: "hidden" };
}
