"use server";

import { z } from "zod";
import { deleteActivity, logActivity } from "@crm/core/records/activities";
import { findDuplicateCompany, saveCompany } from "@crm/core/records/companies";
import { findDuplicateContact, saveContact } from "@crm/core/records/contacts";
import {
  closeDeal,
  moveDealStage,
  reopenDeal,
  saveDeal,
  updatePipeline,
} from "@crm/core/records/deals";
import { convertLead, saveLead } from "@crm/core/records/leads";
import { saveTask, setTaskDone } from "@crm/core/records/tasks";
import {
  purgeRecord,
  reassignRecord,
  restoreRecord,
  softDeleteRecord,
} from "@crm/core/records/trash";
import { updateProfile, updateTenantSettings } from "@crm/core/records/workspace-data";
import { parseMoney } from "@crm/shared/records/money";
import {
  DATE_FORMATS,
  LOCALES,
  LOST_REASONS,
  THEMES,
  WEEK_STARTS,
  activityInput,
  companyInput,
  contactInput,
  dealInput,
  expectedUpdatedAtSchema,
  idSchema,
  leadInput,
  optionalText,
  pipelineStagesInput,
  requiredText,
  taskInput,
} from "@crm/shared/records/schemas";
import { ValidationError } from "@crm/core/errors";
import { actions } from "@/server/actions";

// Record Server Actions (T-04-02..11). Each is a public POST endpoint: the tenant wrapper
// authenticates, authorizes the coarse permission, rate-limits, and parses strictly; services
// re-check record-level rules (own-scope, reassign, references) inside their transactions.

const recordType = z.enum(["company", "contact", "lead", "deal", "task"]);
const target = {
  id: idSchema.nullable(),
  expectedUpdatedAt: expectedUpdatedAtSchema.nullable(),
};
const saveTarget = (input: { id: string | null; expectedUpdatedAt: string | null }) => {
  if (!input.id) return null;
  if (!input.expectedUpdatedAt) {
    throw new ValidationError({ _form: ["Reload the record and try again"] });
  }
  return { id: input.id, expectedUpdatedAt: input.expectedUpdatedAt };
};

export const saveCompanyAction = actions.tenant({
  name: "records.saveCompany",
  permission: "record.create",
  schema: z.object({ ...target, values: companyInput }),
  handler: (ctx, input) => saveCompany(ctx, saveTarget(input), input.values),
});

export const saveContactAction = actions.tenant({
  name: "records.saveContact",
  permission: "record.create",
  schema: z.object({ ...target, values: contactInput }),
  handler: (ctx, input) => saveContact(ctx, saveTarget(input), input.values),
});

export const saveLeadAction = actions.tenant({
  name: "records.saveLead",
  permission: "record.create",
  schema: z.object({ ...target, values: leadInput }),
  handler: (ctx, input) => saveLead(ctx, saveTarget(input), input.values),
});

export const saveDealAction = actions.tenant({
  name: "records.saveDeal",
  permission: "record.create",
  schema: z.object({ ...target, values: dealInput }),
  handler: (ctx, input) => saveDeal(ctx, saveTarget(input), input.values),
});

export const saveTaskAction = actions.tenant({
  name: "records.saveTask",
  permission: "record.create",
  schema: z.object({ ...target, values: taskInput }),
  handler: (ctx, input) => saveTask(ctx, saveTarget(input), input.values),
});

export const deleteRecordAction = actions.tenant({
  name: "records.delete",
  permission: "record.delete",
  schema: z.object({ type: recordType, id: idSchema }),
  handler: (ctx, input) => softDeleteRecord(ctx, input.type, input.id),
});

export const restoreRecordAction = actions.tenant({
  name: "records.restore",
  permission: "record.restore",
  schema: z.object({ type: recordType, id: idSchema }),
  handler: (ctx, input) => restoreRecord(ctx, input.type, input.id),
});

export const purgeRecordAction = actions.tenant({
  name: "records.purge",
  permission: "record.restore",
  schema: z.object({ type: recordType, id: idSchema }),
  handler: (ctx, input) => purgeRecord(ctx, input.type, input.id),
});

export const reassignRecordAction = actions.tenant({
  name: "records.reassign",
  permission: "record.reassign",
  schema: z.object({ type: recordType, id: idSchema, ownerUid: idSchema }),
  handler: (ctx, input) => reassignRecord(ctx, input.type, input.id, input.ownerUid),
});

export const checkDuplicateAction = actions.tenant({
  name: "records.checkDuplicate",
  permission: "record.read",
  schema: z.object({
    type: z.enum(["company", "contact"]),
    value: z.string().trim().min(1).max(2048),
    excludeId: idSchema.nullable(),
  }),
  handler: (ctx, input) =>
    input.type === "company"
      ? findDuplicateCompany(ctx, input.value, input.excludeId)
      : findDuplicateContact(ctx, input.value, input.excludeId),
});

export const convertLeadAction = actions.tenant({
  name: "leads.convert",
  permission: "lead.convert",
  schema: z.object({
    leadId: idSchema,
    contactId: idSchema.nullable(),
    company: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("existing"), id: idSchema }).strict(),
      z.object({ mode: z.literal("new") }).strict(),
      z.object({ mode: z.literal("none") }).strict(),
    ]),
    deal: z
      .object({
        name: requiredText(120),
        amount: z.string().trim().max(20),
      })
      .strict()
      .nullable(),
  }),
  handler: (ctx, input) => {
    let deal = null;
    if (input.deal) {
      const amount = input.deal.amount
        ? parseMoney(input.deal.amount, ctx.tenant.settings.currency)
        : null;
      if (input.deal.amount && amount === null) {
        throw new ValidationError({ "deal.amount": ["Enter a valid amount"] });
      }
      deal = { name: input.deal.name, amount };
    }
    return convertLead(ctx, input.leadId, {
      contactId: input.contactId,
      company: input.company,
      deal,
    });
  },
});

export const moveDealStageAction = actions.tenant({
  name: "deals.moveStage",
  permission: "record.update",
  schema: z.object({ id: idSchema, stageId: idSchema }),
  handler: (ctx, input) => moveDealStage(ctx, input.id, input.stageId),
});

export const closeDealAction = actions.tenant({
  name: "deals.close",
  permission: "record.update",
  schema: z.object({
    id: idSchema,
    outcome: z.discriminatedUnion("outcome", [
      z.object({ outcome: z.literal("won"), markContactCustomer: z.boolean() }).strict(),
      z
        .object({
          outcome: z.literal("lost"),
          lostReason: z.enum(LOST_REASONS),
          lostReasonText: optionalText(500, true),
        })
        .strict(),
    ]),
  }),
  handler: (ctx, input) => closeDeal(ctx, input.id, input.outcome),
});

export const reopenDealAction = actions.tenant({
  name: "deals.reopen",
  permission: "record.update",
  schema: z.object({ id: idSchema, stageId: idSchema }),
  handler: (ctx, input) => reopenDeal(ctx, input.id, input.stageId),
});

export const updatePipelineAction = actions.tenant({
  name: "pipeline.update",
  permission: "pipeline.manage",
  schema: z.object({
    stages: pipelineStagesInput,
    moves: z.record(idSchema, idSchema),
  }),
  handler: (ctx, input) => updatePipeline(ctx, input.stages, input.moves),
});

export const setTaskDoneAction = actions.tenant({
  name: "tasks.setDone",
  permission: "record.update",
  schema: z.object({ id: idSchema, done: z.boolean() }),
  handler: (ctx, input) => setTaskDone(ctx, input.id, input.done),
});

export const logActivityAction = actions.tenant({
  name: "activities.log",
  permission: "record.create",
  schema: z.object({ values: activityInput }),
  handler: (ctx, input) => logActivity(ctx, input.values),
});

export const deleteActivityAction = actions.tenant({
  name: "activities.delete",
  permission: "record.delete",
  schema: z.object({ id: idSchema }),
  handler: (ctx, input) => deleteActivity(ctx, input.id),
});

export const updateTenantSettingsAction = actions.tenant({
  name: "settings.updateWorkspace",
  permission: "settings.manage",
  schema: z.object({
    timezone: z.string().min(1).max(64),
    locale: z.enum(LOCALES),
    currency: z.string().regex(/^[A-Z]{3}$/),
    dateFormat: z.enum(DATE_FORMATS),
    weekStart: z.enum(WEEK_STARTS),
    fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  }),
  handler: (ctx, input) => updateTenantSettings(ctx, input),
});

export const updateProfileAction = actions.tenant({
  name: "settings.updateProfile",
  permission: "member.read",
  schema: z.object({
    displayName: requiredText(120),
    timezone: z.preprocess((v) => (v === "" ? null : v), z.string().min(1).max(64).nullable()),
    theme: z.enum(THEMES),
  }),
  handler: (ctx, input) => updateProfile(ctx, input),
});
