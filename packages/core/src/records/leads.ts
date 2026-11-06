import "server-only";
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { parseMoney } from "@crm/shared/records/money";
import {
  buildSearchTokens,
  foldText,
  normalizeDomain,
  normalizeEmail,
} from "@crm/shared/records/normalize";
import type { LeadInput } from "@crm/shared/records/schemas";
import type { TenantContext } from "../contexts/tenant-context";
import { assertRecordCapacity } from "../config/entitlements";
import { ConflictError, ValidationError } from "../errors";
import { getDb } from "../firebase-admin";
import { canReadRecord, getById, tenantCollection } from "../repositories/base";
import {
  auditRecord,
  bumpCompanyCounts,
  bumpUsage,
  loadForWrite,
  newRecordFields,
  relatedKey,
  systemActivity,
  touchFields,
  type RelatedLabel,
} from "./common";
import { contactNameFields, contactSearchTokens } from "./contacts";
import { firstOpenStage, loadPipeline } from "./deals";
import { toPlain } from "./plain";
import { saveRecord, type SaveTarget } from "./save";

// Leads (FR-LEAD-001..003). Converted leads are read-only.

/** Activity relink inside the conversion transaction up to this many; above → job. */
const RELINK_IN_TX_LIMIT = 400;

export function saveLead(ctx: TenantContext, target: SaveTarget, input: LeadInput) {
  return saveRecord(ctx, "lead", target, async (_tx, existing) => {
    if (existing?.status === "converted") throw new ConflictError("lead_converted");
    let estimatedValue: number | null = null;
    if (input.estimatedValue) {
      estimatedValue = parseMoney(input.estimatedValue, ctx.tenant.settings.currency);
      if (estimatedValue === null) {
        throw new ValidationError({ estimatedValue: ["Enter a valid amount for this currency"] });
      }
    }
    const email = input.email ? normalizeEmail(input.email) : null;
    return {
      fields: {
        firstName: input.firstName,
        lastName: input.lastName,
        ...contactNameFields(input.firstName, input.lastName),
        email,
        emailNormalized: email,
        phone: input.phone,
        companyName: input.companyName,
        jobTitle: input.jobTitle,
        source: input.source,
        status: input.status,
        estimatedValue,
        currency: ctx.tenant.settings.currency,
        notes: input.notes,
        searchTokens: buildSearchTokens([
          input.firstName,
          input.lastName,
          email,
          input.companyName,
        ]),
        ...(existing ? {} : { convertedTo: null, convertedAt: null, convertedBy: null }),
      },
      owner: input.ownerUid,
      tags: input.tags,
    };
  });
}

export async function getLead(ctx: TenantContext, id: string) {
  const doc = await getById(ctx, "leads", id);
  return toPlain(doc) as Record<string, unknown> & { id: string; updatedAt: string };
}

export interface ConvertOptions {
  /** Use this existing contact instead of creating one (must be visible). */
  contactId: string | null;
  /** Existing company id, "new" to create from the lead's company name, or null for none. */
  company: { mode: "existing"; id: string } | { mode: "new" } | { mode: "none" };
  deal: { name: string; amount: number | null } | null;
}

export interface ConvertResult {
  contactId: string;
  companyId: string | null;
  dealId: string | null;
  relinkQueued: boolean;
}

/** Suggestions for the conversion dialog: visible matches by email / company domain or name. */
export async function conversionMatches(ctx: TenantContext, leadId: string) {
  const lead = await getById(ctx, "leads", leadId);
  const contacts = tenantCollection(ctx, "contacts");
  const companies = tenantCollection(ctx, "companies");
  const visible = (coll: "contacts" | "companies", docs: DocumentData[]) =>
    docs.filter((d) => canReadRecord(ctx, coll, d));

  const contactMatch = lead.emailNormalized
    ? visible(
        "contacts",
        (
          await contacts
            .where("isDeleted", "==", false)
            .where("emailNormalized", "==", lead.emailNormalized)
            .limit(5)
            .get()
        ).docs.map((d) => ({ ...d.data(), id: d.id })),
      )[0]
    : undefined;

  const domain = lead.email ? normalizeDomain(String(lead.email).split("@")[1] ?? "") : null;
  let companyMatch: DocumentData | undefined;
  if (domain) {
    companyMatch = visible(
      "companies",
      (
        await companies
          .where("isDeleted", "==", false)
          .where("domainNormalized", "==", domain)
          .limit(5)
          .get()
      ).docs.map((d) => ({ ...d.data(), id: d.id })),
    )[0];
  }
  if (!companyMatch && lead.companyName) {
    companyMatch = visible(
      "companies",
      (
        await companies
          .where("isDeleted", "==", false)
          .where("nameLower", "==", foldText(String(lead.companyName)))
          .limit(5)
          .get()
      ).docs.map((d) => ({ ...d.data(), id: d.id })),
    )[0];
  }
  return {
    contact: contactMatch
      ? {
          id: String(contactMatch.id),
          label: [contactMatch.firstName, contactMatch.lastName].filter(Boolean).join(" "),
        }
      : null,
    company: companyMatch
      ? { id: String(companyMatch.id), label: String(companyMatch.name) }
      : null,
  };
}

/**
 * FR-LEAD-002: one transaction creates/links contact, company, and deal, marks the lead
 * converted, and relinks the lead's activities. Concurrent conversions: the transaction reads the
 * lead status, so the second attempt sees `converted` and fails with CONFLICT.
 */
export async function convertLead(
  ctx: TenantContext,
  leadId: string,
  opts: ConvertOptions,
): Promise<ConvertResult> {
  return getDb().runTransaction(async (tx) => {
    // ---- reads ----
    const { ref: leadRef, data: lead } = await loadForWrite(
      tx,
      ctx,
      "leads",
      leadId,
      "lead.convert",
    );
    if (lead.status === "converted") throw new ConflictError("lead_converted");
    const owner = String(lead.ownerUid);

    let contact: { id: string; data: DocumentData } | null = null;
    if (opts.contactId) {
      const { data } = await loadForWrite(tx, ctx, "contacts", opts.contactId, "record.update");
      contact = { id: opts.contactId, data };
    }
    let company: { id: string; name: string } | null = null;
    if (opts.company.mode === "existing") {
      const { data } = await loadForWrite(tx, ctx, "companies", opts.company.id, "record.read");
      company = { id: opts.company.id, name: String(data.name) };
    } else if (opts.company.mode === "new" && !lead.companyName) {
      throw new ValidationError({ company: ["This lead has no company name"] });
    }
    const pipeline = opts.deal ? await loadPipeline(tx, ctx) : null;
    const leadKey = relatedKey({ type: "lead", id: leadId });
    const activities = await tx.get(
      tenantCollection(ctx, "activities")
        .where("relatedKeys", "array-contains", leadKey)
        .limit(RELINK_IN_TX_LIMIT + 1),
    );

    await assertRecordCapacity(
      tx,
      ctx,
      (opts.contactId ? 0 : 1) + (opts.company.mode === "new" ? 1 : 0) + (opts.deal ? 1 : 0),
    );

    // ---- writes ----
    const companies = tenantCollection(ctx, "companies");
    if (opts.company.mode === "new") {
      const ref = companies.doc();
      const name = String(lead.companyName);
      const domain = lead.email ? normalizeDomain(String(lead.email).split("@")[1] ?? "") : null;
      tx.create(ref, {
        ...newRecordFields(ctx, ref.id),
        name,
        nameLower: foldText(name),
        domain: null,
        domainNormalized: null,
        industry: null,
        sizeBand: null,
        phone: null,
        website: null,
        address: {
          line1: null,
          line2: null,
          city: null,
          region: null,
          postalCode: null,
          country: null,
        },
        description: null,
        ownerUid: owner,
        tags: [],
        counts: { contacts: 0, openDeals: 0 },
        lastActivityAt: null,
        searchTokens: buildSearchTokens([name, domain]),
      });
      bumpUsage(tx, ctx, "companies", 1);
      auditRecord(
        tx,
        ctx,
        "record.created",
        { type: "company", id: ref.id },
        { meta: { via: "lead.convert" } },
      );
      company = { id: ref.id, name };
    }

    let contactId: string;
    if (contact) {
      contactId = contact.id;
      const update: Record<string, unknown> = { ...touchFields(ctx) };
      if (company && !contact.data.companyId) {
        update.companyId = company.id;
        update.companyName = company.name;
        bumpCompanyCounts(tx, ctx, company.id, { contacts: 1 });
      }
      if (contact.data.lifecycleStage === "subscriber" || contact.data.lifecycleStage === "lead") {
        update.lifecycleStage = opts.deal ? "opportunity" : contact.data.lifecycleStage;
      }
      tx.update(tenantCollection(ctx, "contacts").doc(contactId), update);
    } else {
      const ref = tenantCollection(ctx, "contacts").doc();
      contactId = ref.id;
      const email = (lead.emailNormalized as string | null) ?? null;
      const firstName = String(lead.firstName);
      const lastName = (lead.lastName as string | null) ?? null;
      tx.create(ref, {
        ...newRecordFields(ctx, ref.id),
        firstName,
        lastName,
        ...contactNameFields(firstName, lastName),
        email,
        emailNormalized: email,
        phones: lead.phone ? [{ label: "work", number: lead.phone }] : [],
        jobTitle: lead.jobTitle ?? null,
        companyId: company?.id ?? null,
        companyName: company?.name ?? null,
        lifecycleStage: opts.deal ? "opportunity" : "lead",
        leadSource: lead.source ?? null,
        address: {
          line1: null,
          line2: null,
          city: null,
          region: null,
          postalCode: null,
          country: null,
        },
        doNotContact: false,
        notes: lead.notes ?? null,
        ownerUid: owner,
        tags: lead.tags ?? [],
        lastActivityAt: lead.lastActivityAt ?? null,
        convertedFromLeadId: leadId,
        searchTokens: contactSearchTokens({
          firstName,
          lastName,
          email,
          companyName: company?.name ?? null,
        }),
      });
      bumpUsage(tx, ctx, "contacts", 1);
      bumpCompanyCounts(tx, ctx, company?.id, { contacts: 1 });
      auditRecord(
        tx,
        ctx,
        "record.created",
        { type: "contact", id: ref.id },
        { meta: { via: "lead.convert" } },
      );
    }
    const contactName = [
      contact ? contact.data.firstName : lead.firstName,
      contact ? contact.data.lastName : lead.lastName,
    ]
      .filter(Boolean)
      .join(" ");

    let dealId: string | null = null;
    if (opts.deal && pipeline) {
      const stage = firstOpenStage(pipeline);
      const ref = tenantCollection(ctx, "deals").doc();
      dealId = ref.id;
      tx.create(ref, {
        ...newRecordFields(ctx, ref.id),
        name: opts.deal.name,
        nameLower: foldText(opts.deal.name),
        amount: opts.deal.amount ?? 0,
        currency: ctx.tenant.settings.currency,
        pipelineId: "default",
        stageId: stage.id,
        stageEnteredAt: FieldValue.serverTimestamp(),
        status: "open",
        probability: stage.probability,
        expectedCloseDate: null,
        primaryContactId: contactId,
        primaryContactName: contactName,
        companyId: company?.id ?? null,
        companyName: company?.name ?? null,
        lostReason: null,
        lostReasonText: null,
        closedAt: null,
        ownerUid: owner,
        tags: [],
        lastActivityAt: null,
        searchTokens: buildSearchTokens([opts.deal.name, company?.name]),
      });
      bumpUsage(tx, ctx, "deals", 1);
      bumpCompanyCounts(tx, ctx, company?.id, { openDeals: 1 });
      auditRecord(
        tx,
        ctx,
        "record.created",
        { type: "deal", id: ref.id },
        { meta: { via: "lead.convert" } },
      );
    }

    tx.update(leadRef, {
      status: "converted",
      convertedTo: { contactId, companyId: company?.id ?? null, dealId },
      convertedAt: FieldValue.serverTimestamp(),
      convertedBy: ctx.uid,
      ...touchFields(ctx),
    });

    // Relink the lead's activities to the new contact (FR-LEAD-002 AC4).
    const contactRef: RelatedLabel = { type: "contact", id: contactId, label: contactName };
    const relinkQueued = activities.size > RELINK_IN_TX_LIMIT;
    if (relinkQueued) {
      const job = tenantCollection(ctx, "jobs").doc(`relink_${leadId}`);
      tx.set(job, {
        type: "leadActivityRelink",
        status: "queued",
        params: { leadId, contactId },
        requestedBy: ctx.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    } else {
      for (const doc of activities.docs) {
        const related = (doc.get("related") as RelatedLabel[]) ?? [];
        if (related.some((r) => r.type === "contact" && r.id === contactId) || related.length >= 4)
          continue;
        tx.update(doc.ref, {
          related: FieldValue.arrayUnion(contactRef),
          relatedKeys: FieldValue.arrayUnion(relatedKey(contactRef)),
        });
      }
    }

    const leadLabel: RelatedLabel = {
      type: "lead",
      id: leadId,
      label: [lead.firstName, lead.lastName].filter(Boolean).join(" "),
    };
    const related: RelatedLabel[] = [leadLabel, contactRef];
    if (dealId && opts.deal) related.push({ type: "deal", id: dealId, label: opts.deal.name });
    if (company) related.push({ type: "company", id: company.id, label: company.name });
    systemActivity(tx, ctx, "lead.converted", related);
    auditRecord(
      tx,
      ctx,
      "lead.converted",
      { type: "lead", id: leadId },
      {
        meta: { contactId, companyId: company?.id ?? null, dealId },
      },
    );
    return { contactId, companyId: company?.id ?? null, dealId, relinkQueued };
  });
}
