import "server-only";
import { FieldValue, Timestamp, type Transaction, type WriteBatch } from "firebase-admin/firestore";
import { getDb } from "./firebase-admin";

// Append-only audit log (FR-AUD-001/003, requirements/03 §5). Entries are written in the
// same transaction/batch as the change they describe. No code path updates or deletes them;
// only TTL (expireAt) and tenant purge remove them.

export const AUDIT_ACTIONS = [
  "auth.session_created",
  "auth.session_revoked",
  "auth.privileged_login",
  "agency.created",
  "agency.suspended",
  "agency.reactivated",
  "tenant.created",
  "tenant.suspended",
  "tenant.reactivated",
  "invitation.created",
  "invitation.accepted",
  "invitation.revoked",
  "member.joined",
  "staff.joined",
  "auth.password_reset_requested",
  "invitation.resent",
  "member.role_changed",
  "member.removed",
  "member.signed_out",
  "member.records_reassigned",
  "tenant.ownership_transferred",
  "record.created",
  "record.updated",
  "record.deleted",
  "record.restored",
  "record.purged",
  "record.reassigned",
  "lead.converted",
  "deal.stage_changed",
  "deal.won",
  "deal.lost",
  "deal.reopened",
  "task.completed",
  "task.reopened",
  "activity.created",
  "activity.deleted",
  "pipeline.updated",
  "tenant.settings_updated",
  "user.profile_updated",
  "branding.updated",
  "email_template.updated",
  "plan.changed",
  "entitlements.updated",
  "domain.added",
  "domain.activated",
  "domain.canonical_changed",
  "domain.removed",
  "domain.error",
  "export.requested",
  "import.requested",
  "privacy.dsar_exported",
  "privacy.contact_erased",
  "privacy.erasure_reapplied",
  "account.deleted",
  "tenant.deletion_requested",
  "tenant.deletion_cancelled",
  "tenant.purged",
  "billing.gateway_configured",
  "billing.price_set",
  "billing.price_removed",
  "billing.checkout_started",
  "billing.cancel_requested",
  "billing.state_changed",
  "billing.manual_set",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditScope = { tenantId: string } | { agencyId: string } | { platform: true };

export interface AuditEntry {
  action: AuditAction;
  actor: { type: "user" | "platform_admin" | "agency_staff" | "system"; uid?: string | null };
  target: { type: string; id: string };
  /** Field names only — never values (PII). */
  changedFields?: string[];
  /** Non-PII enums/status values only. */
  meta?: Record<string, string | number | boolean | null>;
  requestId: string;
  ip?: string | null;
  userAgent?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function collectionFor(scope: AuditScope): { path: string; retentionDays: number } {
  if ("tenantId" in scope)
    return { path: `tenants/${scope.tenantId}/auditLogs`, retentionDays: 365 };
  if ("agencyId" in scope)
    return { path: `agencies/${scope.agencyId}/auditLogs`, retentionDays: 730 };
  return { path: "platformAuditLogs", retentionDays: 730 };
}

function documentFor(scope: AuditScope, entry: AuditEntry) {
  const { path, retentionDays } = collectionFor(scope);
  const ref = getDb().collection(path).doc();
  const data = {
    ...entry,
    ...("tenantId" in scope ? { tenantId: scope.tenantId } : {}),
    ...("agencyId" in scope ? { agencyId: scope.agencyId } : {}),
    userAgent: entry.userAgent?.slice(0, 300) ?? null,
    createdAt: FieldValue.serverTimestamp(),
    expireAt: Timestamp.fromMillis(Date.now() + retentionDays * DAY_MS),
  };
  return { ref, data };
}

/** Record an audit entry inside the caller's transaction or batch (preferred). */
export function audit(
  writer: Transaction | WriteBatch,
  scope: AuditScope,
  entry: AuditEntry,
): void {
  const { ref, data } = documentFor(scope, entry);
  (writer as WriteBatch).create(ref, data);
}

/** Record a standalone audit entry (events with no other write, e.g. sign-in). */
export async function auditNow(scope: AuditScope, entry: AuditEntry): Promise<void> {
  const { ref, data } = documentFor(scope, entry);
  await ref.create(data);
}
