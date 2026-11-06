"use server";

import { z } from "zod";
import { exportAudit, listAudit } from "@crm/core/audit-viewer";
import { requestListExport, requestTenantExport } from "@crm/core/jobs/exports";
import { previewImport, startImport } from "@crm/core/jobs/imports";
import { POLICIES } from "@crm/core/rate-limit";
import { deliverQueuedMailToConsole } from "@crm/core/mail";
import {
  NOTIFICATION_TYPES,
  listNotifications,
  markRead,
  unreadCount,
  unsubscribe,
  updateNotificationPrefs,
} from "@crm/core/notifications";
import { deleteAccount, eraseContact, exportContactData } from "@crm/core/privacy";
import { globalSearch } from "@crm/core/records/search";
import { cancelTenantDeletion, requestTenantDeletion } from "@crm/core/tenant-deletion";
import { DUPLICATE_MODES, IMPORT_ENTITIES } from "@crm/shared/import";
import { LIST_ENTITIES } from "@crm/shared/records/list-specs";
import { idSchema } from "@crm/shared/records/schemas";
import { AUDIT_ACTIONS } from "@crm/core/audit";
import { actions } from "@/server/actions";

// Phase 6 actions: search, notifications, import/export, audit, privacy, deletion. Each re-checks
// permissions in the service; read-type actions still go through the wrapper (session, Origin,
// strict input, rate limit).

const cursorSchema = z.string().max(1024).nullable();
const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

export const searchAction = actions.tenant({
  name: "search.global",
  permission: "record.read",
  schema: z.object({ q: z.string().max(100) }),
  handler: (ctx, input) => globalSearch(ctx, input.q),
});

export const notificationsAction = actions.tenant({
  name: "notifications.list",
  permission: "member.read",
  schema: z.object({ cursor: cursorSchema }),
  handler: async (ctx, input) => ({
    ...(await listNotifications(ctx, input.cursor)),
    unread: await unreadCount(ctx),
  }),
});

export const unreadCountAction = actions.tenant({
  name: "notifications.unreadCount",
  permission: "member.read",
  schema: z.object({}),
  handler: async (ctx) => ({ unread: await unreadCount(ctx) }),
});

export const markReadAction = actions.tenant({
  name: "notifications.markRead",
  permission: "member.read",
  schema: z.object({ id: z.union([idSchema, z.literal("all")]) }),
  handler: (ctx, input) => markRead(ctx, input.id),
});

const channel = z.object({ inApp: z.boolean(), email: z.boolean() }).strict();
export const updateNotificationPrefsAction = actions.tenant({
  name: "notifications.updatePrefs",
  permission: "member.read",
  schema: z.object({
    prefs: z
      .object(
        Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, channel])) as Record<
          (typeof NOTIFICATION_TYPES)[number],
          typeof channel
        >,
      )
      .strict(),
  }),
  handler: (ctx, input) => updateNotificationPrefs(ctx, input.prefs),
});

/** One-click unsubscribe: the signed token is the proof (no session needed). */
export const unsubscribeAction = actions.public({
  name: "notifications.unsubscribe",
  rateLimit: POLICIES.passwordResetByIp,
  schema: z.object({ token: z.string().min(20).max(512) }),
  handler: (input) => unsubscribe(input.token),
});

const importMapping = z.array(z.string().max(40).nullable()).max(200);

export const previewImportAction = actions.tenant({
  name: "imports.preview",
  permission: "import.run",
  schema: z.object({
    uploadId: z.string().max(64),
    entity: z.enum(IMPORT_ENTITIES),
    mapping: importMapping.nullable(),
  }),
  handler: (ctx, input) => previewImport(ctx, input.uploadId, input.entity, input.mapping),
});

export const startImportAction = actions.tenant({
  name: "imports.start",
  permission: "import.run",
  schema: z.object({
    uploadId: z.string().max(64),
    entity: z.enum(IMPORT_ENTITIES),
    mapping: importMapping,
    duplicateMode: z.enum(DUPLICATE_MODES),
  }),
  handler: async (ctx, input) => {
    const result = await startImport(ctx, input);
    await deliverQueuedMailToConsole();
    return result;
  },
});

export const exportListAction = actions.tenant({
  name: "exports.list",
  permission: "record.export",
  schema: z.object({
    entity: z.enum(LIST_ENTITIES),
    sort: z.string().max(20).optional(),
    filter: z.string().max(20).optional(),
    value: z.string().max(64).optional(),
  }),
  handler: async (ctx, { entity, ...query }) => {
    const result = await requestListExport(ctx, entity, query);
    await deliverQueuedMailToConsole();
    return result;
  },
});

export const exportTenantAction = actions.tenant({
  name: "exports.tenant",
  permission: "tenant.export",
  reauth: true,
  schema: z.object({}),
  handler: async (ctx) => {
    const result = await requestTenantExport(ctx);
    await deliverQueuedMailToConsole();
    return result;
  },
});

const auditFilter = {
  action: z.enum(AUDIT_ACTIONS).nullable(),
  actorUid: idSchema.nullable(),
  from: dateKey,
  to: dateKey,
};

export const auditListAction = actions.tenant({
  name: "audit.list",
  permission: "audit.read",
  schema: z.object({ ...auditFilter, cursor: cursorSchema }),
  handler: (ctx, { cursor, ...filter }) => listAudit(ctx, filter, cursor),
});

export const auditExportAction = actions.tenant({
  name: "audit.export",
  permission: "audit.read",
  schema: z.object(auditFilter),
  handler: async (ctx, filter) => ({ csv: await exportAudit(ctx, filter) }),
});

export const exportContactDataAction = actions.tenant({
  name: "privacy.exportContact",
  permission: "privacy.manage",
  schema: z.object({ contactId: idSchema }),
  handler: (ctx, input) => exportContactData(ctx, input.contactId),
});

export const eraseContactAction = actions.tenant({
  name: "privacy.eraseContact",
  permission: "privacy.manage",
  reauth: true,
  schema: z.object({ contactId: idSchema }),
  handler: (ctx, input) => eraseContact(ctx, input.contactId),
});

export const deleteAccountAction = actions.tenant({
  name: "account.delete",
  permission: "member.read",
  reauth: true,
  schema: z.object({}),
  handler: (ctx) => deleteAccount(ctx),
});

export const requestTenantDeletionAction = actions.tenant({
  name: "tenant.requestDeletion",
  permission: "tenant.delete",
  reauth: true,
  schema: z.object({ confirmSlug: z.string().max(60) }),
  handler: (ctx, input) => requestTenantDeletion(ctx, input.confirmSlug),
});

export const cancelTenantDeletionAction = actions.tenant({
  name: "tenant.cancelDeletion",
  permission: "tenant.delete",
  schema: z.object({}),
  handler: (ctx) => cancelTenantDeletion(ctx),
});
