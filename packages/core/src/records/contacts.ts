import "server-only";
import { buildSearchTokens, foldText, normalizeEmail } from "@crm/shared/records/normalize";
import type { ContactInput } from "@crm/shared/records/schemas";
import type { TenantContext } from "../contexts/tenant-context";
import { canReadRecord, getById, tenantCollection } from "../repositories/base";
import { bumpCompanyCounts, loadReference, systemActivity } from "./common";
import type { DuplicateResult } from "./companies";
import { toPlain } from "./plain";
import { saveRecord, type SaveTarget } from "./save";

// Contacts & customers (FR-CON-001..004). "Customers" = contacts with lifecycleStage customer.

export function contactSearchTokens(c: {
  firstName: string;
  lastName: string | null;
  email: string | null;
  companyName: string | null;
}) {
  return buildSearchTokens([c.firstName, c.lastName, c.email, c.companyName]);
}

export function contactNameFields(firstName: string, lastName: string | null) {
  return { fullNameLower: foldText([firstName, lastName].filter(Boolean).join(" ")) };
}

export function saveContact(ctx: TenantContext, target: SaveTarget, input: ContactInput) {
  return saveRecord(ctx, "contact", target, async (tx, existing) => {
    let companyName: string | null = null;
    const companyChanged = (existing?.companyId ?? null) !== input.companyId;
    if (input.companyId) {
      companyName = companyChanged
        ? (await loadReference(tx, ctx, "company", input.companyId, "companyId")).label
        : ((existing?.companyName as string | null) ?? null);
    }
    const email = input.email ? normalizeEmail(input.email) : null;
    return {
      fields: {
        firstName: input.firstName,
        lastName: input.lastName,
        ...contactNameFields(input.firstName, input.lastName),
        email,
        emailNormalized: email,
        phones: input.phones,
        jobTitle: input.jobTitle,
        companyId: input.companyId,
        companyName,
        lifecycleStage: input.lifecycleStage,
        leadSource: input.leadSource,
        address: input.address,
        doNotContact: input.doNotContact,
        notes: input.notes,
        searchTokens: contactSearchTokens({ ...input, email, companyName }),
        ...(existing ? {} : { convertedFromLeadId: null }),
      },
      owner: input.ownerUid,
      tags: input.tags,
      effects: (tx, saved) => {
        const before = saved.before;
        if (!before) {
          bumpCompanyCounts(tx, ctx, input.companyId, { contacts: 1 });
          return;
        }
        if (companyChanged) {
          bumpCompanyCounts(tx, ctx, before.companyId as string | null, { contacts: -1 });
          bumpCompanyCounts(tx, ctx, input.companyId, { contacts: 1 });
          systemActivity(tx, ctx, "contact.company_changed", [saved.self!], {
            from: (before.companyId as string | null) ?? null,
            to: input.companyId,
          });
        }
        if (before.lifecycleStage !== input.lifecycleStage) {
          systemActivity(tx, ctx, "contact.lifecycle_changed", [saved.self!], {
            from: (before.lifecycleStage as string | null) ?? null,
            to: input.lifecycleStage,
          });
        }
      },
    };
  });
}

export async function getContact(ctx: TenantContext, id: string) {
  const doc = await getById(ctx, "contacts", id);
  return toPlain(doc) as Record<string, unknown> & { id: string; updatedAt: string };
}

/** FR-CON-003 duplicate warning (existence-only for records the actor can't see). */
export async function findDuplicateContact(
  ctx: TenantContext,
  email: string,
  excludeId: string | null,
): Promise<DuplicateResult> {
  const normalized = normalizeEmail(email);
  if (!normalized) return { status: "none" };
  const snap = await tenantCollection(ctx, "contacts")
    .where("isDeleted", "==", false)
    .where("emailNormalized", "==", normalized)
    .limit(2)
    .get();
  const match = snap.docs.find((d) => d.id !== excludeId);
  if (!match) return { status: "none" };
  return canReadRecord(ctx, "contacts", match.data())
    ? {
        status: "visible",
        id: match.id,
        label: [match.get("firstName"), match.get("lastName")].filter(Boolean).join(" "),
      }
    : { status: "hidden" };
}
