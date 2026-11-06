import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import {
  OVERRIDABLE_EMAILS,
  type EmailOverrideInput,
  type OverridableEmail,
} from "@crm/shared/branding/schemas";
import { audit } from "../audit";
import { authorize } from "../authz";
import type { TenantContext } from "../contexts/tenant-context";
import { NotFoundError } from "../errors";
import { getDb } from "../firebase-admin";
import { deliverQueuedMailToConsole, queueMailNow } from "../mail";
import { brandForMessage } from "../mail-delivery";
import { renderMail, type RenderedMail } from "../mail-render";
import type { MemberDoc } from "../model";
import { enforceRateLimit } from "../rate-limit";
import { hostUrl } from "../urls";

// Workspace email template overrides, preview, and test send (FR-BRAND-003 AC1/AC4).

export const TEST_SEND_POLICY = { name: "mail-test:tenant", limit: 10, windowSeconds: 86_400 };

export async function listEmailOverrides(ctx: TenantContext) {
  authorize(ctx, "branding.manage");
  const snaps = await getDb().getAll(
    ...OVERRIDABLE_EMAILS.map((k) => getDb().doc(`tenants/${ctx.tenantId}/emailTemplates/${k}`)),
  );
  return OVERRIDABLE_EMAILS.map((template, i) => ({
    template,
    subject: (snaps[i]!.get("subject") as string | null | undefined) ?? null,
    intro: (snaps[i]!.get("intro") as string | null | undefined) ?? null,
  }));
}

export async function saveEmailOverride(ctx: TenantContext, input: EmailOverrideInput) {
  authorize(ctx, "branding.manage");
  const batch = getDb().batch();
  batch.set(getDb().doc(`tenants/${ctx.tenantId}/emailTemplates/${input.template}`), {
    subject: input.subject,
    intro: input.intro,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: ctx.uid,
  });
  audit(
    batch,
    { tenantId: ctx.tenantId },
    {
      action: "email_template.updated",
      actor: { type: "user", uid: ctx.uid },
      target: { type: "emailTemplate", id: input.template },
      changedFields: ["subject", "intro"],
      requestId: ctx.requestId,
    },
  );
  await batch.commit();
  return { ok: true };
}

function sampleVariables(ctx: TenantContext, template: OverridableEmail): Record<string, string> {
  const host = ctx.tenant.canonicalHost;
  switch (template) {
    case "workspace_invitation":
      return { name: ctx.tenant.name, link: hostUrl(host, "/invite/preview-only") };
    case "password_reset":
      return { link: hostUrl(host, "/login") };
    case "ownership_transferred":
      return { workspace: ctx.tenant.name };
  }
}

/** Preview with the stored override, or with unsaved values from the editor. */
export async function previewEmail(
  ctx: TenantContext,
  template: OverridableEmail,
  draft: { subject: string | null; intro: string | null } | null,
): Promise<RenderedMail> {
  authorize(ctx, "branding.manage");
  const { brand, override } = await brandForMessage({ tenantId: ctx.tenantId, template });
  return renderMail(template, sampleVariables(ctx, template), brand, draft ?? override);
}

/** Test send to the requesting user only, max 10 per workspace per day. */
export async function sendTestEmail(ctx: TenantContext, template: OverridableEmail) {
  authorize(ctx, "branding.manage");
  await enforceRateLimit(TEST_SEND_POLICY, ctx.tenantId);
  const member = (await getDb().doc(`tenants/${ctx.tenantId}/members/${ctx.uid}`).get()).data() as
    MemberDoc | undefined;
  if (!member?.email) throw new NotFoundError("member");
  await queueMailNow({
    template,
    to: member.email,
    variables: sampleVariables(ctx, template),
    tenantId: ctx.tenantId,
  });
  await deliverQueuedMailToConsole();
  return { email: member.email };
}
