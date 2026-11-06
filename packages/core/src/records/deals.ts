import "server-only";
import { randomBytes } from "node:crypto";
import {
  AggregateField,
  FieldValue,
  Timestamp,
  type DocumentData,
  type Transaction,
} from "firebase-admin/firestore";
import { workspaceScope } from "@crm/shared/permissions";
import { parseMoney } from "@crm/shared/records/money";
import { buildSearchTokens, foldText } from "@crm/shared/records/normalize";
import type { DealInput } from "@crm/shared/records/schemas";
import { authorize } from "../authz";
import type { TenantContext } from "../contexts/tenant-context";
import { ConflictError, ForbiddenError, ValidationError } from "../errors";
import { getDb } from "../firebase-admin";
import { getById, scopedQuery, tenantCollection } from "../repositories/base";
import {
  auditRecord,
  bumpCompanyCounts,
  loadForWrite,
  loadReference,
  systemActivity,
  touchFields,
  type RelatedLabel,
} from "./common";
import { toPlain } from "./plain";
import { saveRecord, type SaveTarget } from "./save";

// Deals & pipeline (FR-DEAL-001..004). Single default pipeline in the MVP. Money is integer
// minor units in the workspace currency.

export interface Stage {
  id: string;
  name: string;
  order: number;
  probability: number;
  kind: "open" | "won" | "lost";
}
export interface Pipeline {
  name: string;
  isDefault: boolean;
  stages: Stage[];
}

export const PIPELINE_ID = "default";

export const DEFAULT_PIPELINE: Pipeline = {
  name: "Sales pipeline",
  isDefault: true,
  stages: [
    { id: "stg_qualification", name: "Qualification", order: 1, probability: 10, kind: "open" },
    { id: "stg_discovery", name: "Discovery", order: 2, probability: 25, kind: "open" },
    { id: "stg_proposal", name: "Proposal", order: 3, probability: 50, kind: "open" },
    { id: "stg_negotiation", name: "Negotiation", order: 4, probability: 75, kind: "open" },
    { id: "stg_won", name: "Won", order: 5, probability: 100, kind: "won" },
    { id: "stg_lost", name: "Lost", order: 6, probability: 0, kind: "lost" },
  ],
};

/** The workspace pipeline; workspaces created before pipelines existed get the default. */
export async function loadPipeline(tx: Transaction | null, ctx: TenantContext): Promise<Pipeline> {
  const ref = tenantCollection(ctx, "pipelines").doc(PIPELINE_ID);
  const snap = tx ? await tx.get(ref) : await ref.get();
  const data = snap.data() as Pipeline | undefined;
  const stages = [...(data?.stages ?? DEFAULT_PIPELINE.stages)].sort((a, b) => a.order - b.order);
  return { ...(data ?? DEFAULT_PIPELINE), stages };
}

export function getPipeline(ctx: TenantContext): Promise<Pipeline> {
  authorize(ctx, "record.read");
  return loadPipeline(null, ctx);
}

export const openStages = (p: Pipeline) => p.stages.filter((s) => s.kind === "open");
export const firstOpenStage = (p: Pipeline) => openStages(p)[0]!;
const stageOfKind = (p: Pipeline, kind: "won" | "lost") => p.stages.find((s) => s.kind === kind)!;

function dateToTimestamp(date: string | null): Timestamp | null {
  return date ? Timestamp.fromDate(new Date(`${date}T00:00:00Z`)) : null;
}

export function saveDeal(ctx: TenantContext, target: SaveTarget, input: DealInput) {
  return saveRecord(ctx, "deal", target, async (tx, existing) => {
    const pipeline = await loadPipeline(tx, ctx);
    const status = (existing?.status as string | undefined) ?? "open";
    const stage = pipeline.stages.find((s) => s.id === input.stageId);
    if (status === "open" ? stage?.kind !== "open" : input.stageId !== existing?.stageId) {
      throw new ValidationError({ stageId: ["Choose an open stage"] });
    }
    const currency = ctx.tenant.settings.currency;
    let amount = 0;
    if (input.amount) {
      const parsed = parseMoney(input.amount, currency);
      if (parsed === null) throw new ValidationError({ amount: ["Enter a valid amount"] });
      amount = parsed;
    }
    const contact = input.primaryContactId
      ? input.primaryContactId === existing?.primaryContactId
        ? { label: String(existing.primaryContactName ?? "") }
        : await loadReference(tx, ctx, "contact", input.primaryContactId, "primaryContactId")
      : null;
    const company = input.companyId
      ? input.companyId === existing?.companyId
        ? { label: String(existing.companyName ?? "") }
        : await loadReference(tx, ctx, "company", input.companyId, "companyId")
      : null;
    const stageChanged = existing?.stageId !== input.stageId;

    return {
      fields: {
        name: input.name,
        nameLower: foldText(input.name),
        amount,
        currency,
        pipelineId: PIPELINE_ID,
        stageId: input.stageId,
        ...(stageChanged ? { stageEnteredAt: FieldValue.serverTimestamp() } : {}),
        probability: input.probability ?? stage?.probability ?? 0,
        expectedCloseDate: dateToTimestamp(input.expectedCloseDate),
        primaryContactId: input.primaryContactId,
        primaryContactName: contact?.label ?? null,
        companyId: input.companyId,
        companyName: company?.label ?? null,
        searchTokens: buildSearchTokens([input.name, company?.label]),
        ...(existing
          ? {}
          : { status: "open", lostReason: null, lostReasonText: null, closedAt: null }),
      },
      owner: input.ownerUid,
      tags: input.tags,
      effects: (tx, saved) => {
        const before = saved.before;
        const isOpen = status === "open";
        if (!before) {
          if (isOpen) bumpCompanyCounts(tx, ctx, input.companyId, { openDeals: 1 });
          return;
        }
        if (isOpen && before.companyId !== input.companyId) {
          bumpCompanyCounts(tx, ctx, before.companyId as string | null, { openDeals: -1 });
          bumpCompanyCounts(tx, ctx, input.companyId, { openDeals: 1 });
        }
        if (stageChanged) {
          systemActivity(tx, ctx, "deal.stage_changed", [saved.self!], {
            from: String(before.stageId),
            to: input.stageId,
          });
        }
      },
    };
  });
}

export async function getDeal(ctx: TenantContext, id: string) {
  const doc = await getById(ctx, "deals", id);
  return toPlain(doc) as Record<string, unknown> & { id: string; updatedAt: string };
}

const dealLabel = (id: string, data: DocumentData): RelatedLabel => ({
  type: "deal",
  id,
  label: String(data.name),
});

/** Kanban move (FR-DEAL-003, FR-DEAL-004 AC2): open deals between open stages. */
export async function moveDealStage(ctx: TenantContext, id: string, stageId: string) {
  authorize(ctx, "record.update");
  return getDb().runTransaction(async (tx) => {
    const { ref, data } = await loadForWrite(tx, ctx, "deals", id, "record.update");
    const pipeline = await loadPipeline(tx, ctx);
    if (data.status !== "open") throw new ConflictError("deal_closed");
    const stage = pipeline.stages.find((s) => s.id === stageId && s.kind === "open");
    if (!stage) throw new ValidationError({ stageId: ["Choose an open stage"] });
    if (data.stageId === stageId) return { id, stageId };
    tx.update(ref, {
      stageId,
      stageEnteredAt: FieldValue.serverTimestamp(),
      probability: stage.probability,
      ...touchFields(ctx),
    });
    systemActivity(tx, ctx, "deal.stage_changed", [dealLabel(id, data)], {
      from: String(data.stageId),
      to: stageId,
    });
    auditRecord(
      tx,
      ctx,
      "deal.stage_changed",
      { type: "deal", id },
      {
        meta: { fromStage: String(data.stageId), toStage: stageId },
      },
    );
    return { id, stageId };
  });
}

export type CloseInput =
  | { outcome: "won"; markContactCustomer: boolean }
  | { outcome: "lost"; lostReason: string; lostReasonText: string | null };

/** FR-DEAL-004 + FR-CON-004 AC2 (won → optionally mark the primary contact as customer). */
export async function closeDeal(ctx: TenantContext, id: string, input: CloseInput) {
  authorize(ctx, "record.update");
  return getDb().runTransaction(async (tx) => {
    const { ref, data } = await loadForWrite(tx, ctx, "deals", id, "record.update");
    const pipeline = await loadPipeline(tx, ctx);
    if (data.status !== "open") throw new ConflictError("deal_closed");
    let contact: { ref: FirebaseFirestore.DocumentReference; data: DocumentData } | null = null;
    if (input.outcome === "won" && input.markContactCustomer && data.primaryContactId) {
      try {
        contact = await loadForWrite(
          tx,
          ctx,
          "contacts",
          String(data.primaryContactId),
          "record.update",
        );
      } catch {
        contact = null; // not visible/editable for this actor: skip the prompt's effect
      }
    }
    const stage = stageOfKind(pipeline, input.outcome);
    tx.update(ref, {
      status: input.outcome,
      stageId: stage.id,
      stageEnteredAt: FieldValue.serverTimestamp(),
      probability: stage.probability,
      closedAt: FieldValue.serverTimestamp(),
      lostReason: input.outcome === "lost" ? input.lostReason : null,
      lostReasonText: input.outcome === "lost" ? input.lostReasonText : null,
      ...touchFields(ctx),
    });
    bumpCompanyCounts(tx, ctx, data.companyId as string | null, { openDeals: -1 });
    const event = input.outcome === "won" ? "deal.won" : "deal.lost";
    systemActivity(tx, ctx, event, [dealLabel(id, data)], {
      from: String(data.stageId),
      to: stage.id,
      ...(input.outcome === "lost" ? { reason: input.lostReason } : {}),
    });
    auditRecord(
      tx,
      ctx,
      event,
      { type: "deal", id },
      { meta: { fromStage: String(data.stageId) } },
    );
    let contactUpdated = false;
    if (contact && contact.data.lifecycleStage !== "customer") {
      tx.update(contact.ref, { lifecycleStage: "customer", ...touchFields(ctx) });
      systemActivity(
        tx,
        ctx,
        "contact.lifecycle_changed",
        [
          {
            type: "contact",
            id: contact.ref.id,
            label: [contact.data.firstName, contact.data.lastName].filter(Boolean).join(" "),
          },
        ],
        { from: String(contact.data.lifecycleStage ?? ""), to: "customer" },
      );
      auditRecord(
        tx,
        ctx,
        "record.updated",
        { type: "contact", id: contact.ref.id },
        {
          changedFields: ["lifecycleStage"],
        },
      );
      contactUpdated = true;
    }
    return { id, status: input.outcome, contactUpdated };
  });
}

/** FR-DEAL-004 AC3: reopening is Manager+ and audited. */
export async function reopenDeal(ctx: TenantContext, id: string, stageId: string) {
  if (workspaceScope(ctx.role, "record.update") !== "all") throw new ForbiddenError("reopen");
  return getDb().runTransaction(async (tx) => {
    const { ref, data } = await loadForWrite(tx, ctx, "deals", id, "record.update");
    const pipeline = await loadPipeline(tx, ctx);
    if (data.status === "open") throw new ConflictError("deal_open");
    const stage = pipeline.stages.find((s) => s.id === stageId && s.kind === "open");
    if (!stage) throw new ValidationError({ stageId: ["Choose an open stage"] });
    tx.update(ref, {
      status: "open",
      stageId,
      stageEnteredAt: FieldValue.serverTimestamp(),
      probability: stage.probability,
      closedAt: null,
      lostReason: null,
      lostReasonText: null,
      ...touchFields(ctx),
    });
    bumpCompanyCounts(tx, ctx, data.companyId as string | null, { openDeals: 1 });
    systemActivity(tx, ctx, "deal.reopened", [dealLabel(id, data)], {
      from: String(data.stageId),
      to: stageId,
    });
    auditRecord(
      tx,
      ctx,
      "deal.reopened",
      { type: "deal", id },
      {
        meta: { fromStatus: String(data.status) },
      },
    );
    return { id };
  });
}

export const BOARD_COLUMN_LIMIT = 20;

export interface BoardColumn {
  stage: Stage;
  deals: Array<Record<string, unknown> & { id: string }>;
  count: number;
  sum: number;
}

/**
 * Board (FR-DEAL-003 AC1): per open stage, the newest 20 cards plus count and summed amount
 * via aggregation queries (no full scans). Members' columns are own-scoped by scopedQuery.
 */
export async function loadBoard(ctx: TenantContext): Promise<{
  pipeline: Pipeline;
  columns: BoardColumn[];
  currency: string;
}> {
  const pipeline = await getPipeline(ctx);
  const columns = await Promise.all(
    openStages(pipeline).map(async (stage): Promise<BoardColumn> => {
      const q = scopedQuery(ctx, "deals")
        .where("pipelineId", "==", PIPELINE_ID)
        .where("status", "==", "open")
        .where("stageId", "==", stage.id);
      const [snap, agg] = await Promise.all([
        q.orderBy("updatedAt", "desc").limit(BOARD_COLUMN_LIMIT).get(),
        q.aggregate({ count: AggregateField.count(), sum: AggregateField.sum("amount") }).get(),
      ]);
      return {
        stage,
        deals: snap.docs.map((d) => ({
          ...(toPlain(d.data()) as Record<string, unknown>),
          id: d.id,
        })),
        count: agg.data().count,
        sum: agg.data().sum ?? 0,
      };
    }),
  );
  return { pipeline, columns, currency: ctx.tenant.settings.currency };
}

/**
 * FR-DEAL-002: Owner/Admin edits open stages (2–15); Won/Lost stay fixed. Deals in removed stages
 * move to the chosen target stage (chunked writes) before the pipeline doc changes.
 */
export async function updatePipeline(
  ctx: TenantContext,
  stages: Array<{ id: string | null; name: string; probability: number }>,
  moves: Record<string, string>,
): Promise<{ moved: number }> {
  authorize(ctx, "pipeline.manage");
  const current = await loadPipeline(null, ctx);
  const ids = new Set<string>();
  const nextOpen: Stage[] = stages.map((s, i) => {
    const id = s.id ?? `stg_${randomBytes(6).toString("base64url")}`;
    if (s.id && !openStages(current).some((c) => c.id === s.id)) {
      throw new ValidationError({ stages: ["Unknown stage"] });
    }
    if (ids.has(id)) throw new ValidationError({ stages: ["Duplicate stage"] });
    ids.add(id);
    return { id, name: s.name, probability: s.probability, order: i + 1, kind: "open" };
  });
  const removed = openStages(current).filter((s) => !ids.has(s.id));
  let moved = 0;
  for (const stage of removed) {
    const target = moves[stage.id];
    if (!target || !ids.has(target)) {
      throw new ValidationError({ moves: [`Choose where deals in "${stage.name}" should go`] });
    }
    const targetStage = nextOpen.find((s) => s.id === target)!;
    // Chunked move (≤ 400 writes per batch); deleted deals move too so restore stays valid.
    for (;;) {
      const snap = await tenantCollection(ctx, "deals")
        .where("pipelineId", "==", PIPELINE_ID)
        .where("stageId", "==", stage.id)
        .limit(400)
        .get();
      if (snap.empty) break;
      const batch = getDb().batch();
      for (const doc of snap.docs) {
        batch.update(doc.ref, {
          stageId: target,
          probability: targetStage.probability,
          stageEnteredAt: FieldValue.serverTimestamp(),
          ...touchFields(ctx),
        });
      }
      await batch.commit();
      moved += snap.size;
    }
  }
  const fixed = current.stages
    .filter((s) => s.kind !== "open")
    .map((s, i) => ({ ...s, order: nextOpen.length + i + 1 }));
  await getDb().runTransaction(async (tx) => {
    tx.set(tenantCollection(ctx, "pipelines").doc(PIPELINE_ID), {
      name: current.name,
      isDefault: true,
      stages: [...nextOpen, ...fixed],
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: ctx.uid,
    });
    auditRecord(
      tx,
      ctx,
      "pipeline.updated",
      { type: "pipeline", id: PIPELINE_ID },
      {
        meta: { openStages: nextOpen.length, removed: removed.length, moved },
      },
    );
  });
  return { moved };
}
