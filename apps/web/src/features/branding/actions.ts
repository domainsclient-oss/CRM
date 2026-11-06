"use server";

import { z } from "zod";
import { previewEmail, saveEmailOverride, sendTestEmail } from "@crm/core/branding/emails";
import { removeBrandAsset, updateBranding, uploadBrandAsset } from "@crm/core/branding/service";
import {
  BRAND_ASSET_KINDS,
  OVERRIDABLE_EMAILS,
  brandingInput,
  emailOverrideInput,
} from "@crm/shared/branding/schemas";
import { actions } from "@/server/actions";

// Workspace branding + email template actions (T-05-01/03). Service-level checks also require
// the agency's allowWorkspaceBranding entitlement for branding changes.

const fileSchema = z
  .instanceof(File)
  .refine((f) => f.size <= 1024 * 1024 + 1, "The file is larger than 1024 KB");

export const updateWorkspaceBrandingAction = actions.tenant({
  name: "branding.updateWorkspace",
  permission: "branding.manage",
  schema: brandingInput,
  handler: (ctx, input) =>
    updateBranding({ kind: "tenant", ctx }, { level: "workspace", tenantId: ctx.tenantId }, input),
});

export const uploadWorkspaceAssetAction = actions.tenant({
  name: "branding.uploadWorkspaceAsset",
  permission: "branding.manage",
  schema: z.object({ kind: z.enum(BRAND_ASSET_KINDS), file: fileSchema }),
  handler: async (ctx, input) =>
    uploadBrandAsset(
      { kind: "tenant", ctx },
      { level: "workspace", tenantId: ctx.tenantId },
      input.kind,
      new Uint8Array(await input.file.arrayBuffer()),
    ),
});

export const removeWorkspaceAssetAction = actions.tenant({
  name: "branding.removeWorkspaceAsset",
  permission: "branding.manage",
  schema: z.object({ kind: z.enum(BRAND_ASSET_KINDS) }),
  handler: (ctx, input) =>
    removeBrandAsset(
      { kind: "tenant", ctx },
      { level: "workspace", tenantId: ctx.tenantId },
      input.kind,
    ),
});

export const saveEmailOverrideAction = actions.tenant({
  name: "emails.saveOverride",
  permission: "branding.manage",
  schema: emailOverrideInput,
  handler: (ctx, input) => saveEmailOverride(ctx, input),
});

export const previewEmailAction = actions.tenant({
  name: "emails.preview",
  permission: "branding.manage",
  schema: z.object({
    template: z.enum(OVERRIDABLE_EMAILS),
    subject: z.string().max(200).nullable(),
    intro: z.string().max(1000).nullable(),
  }),
  handler: async (ctx, input) => {
    // Validate the draft with the same rules as save, so previews can't render rejected text.
    const draft = emailOverrideInput.parse(input);
    return previewEmail(ctx, draft.template, { subject: draft.subject, intro: draft.intro });
  },
});

export const sendTestEmailAction = actions.tenant({
  name: "emails.sendTest",
  permission: "branding.manage",
  schema: z.object({ template: z.enum(OVERRIDABLE_EMAILS) }),
  handler: (ctx, input) => sendTestEmail(ctx, input.template),
});
