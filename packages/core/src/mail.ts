import "server-only";
import { FieldValue, Timestamp, type Transaction, type WriteBatch } from "firebase-admin/firestore";
import { getDb } from "./firebase-admin";
import { getServerEnv } from "./server-env";

// Transactional email via an outbox (ADR-012, requirements/02 §9). Messages are written
// in the same transaction as the change that triggers them; a sender delivers them later
// (Cloud Function in hosted envs, T-05-03). Locally, the "console" provider prints them.

export const MAIL_TEMPLATES = [
  "workspace_invitation",
  "agency_invitation",
  "password_reset",
  "privileged_login_alert",
  "ownership_transferred",
  "notification",
  "workspace_finder",
  "gateway_credentials_changed",
  "billing_status_changed",
  "demo_request_confirmation",
] as const;
export type MailTemplate = (typeof MAIL_TEMPLATES)[number];

export interface MailMessage {
  template: MailTemplate;
  to: string;
  /** Plain values; templates HTML-escape everything (FR-BRAND-003). */
  variables: Record<string, string>;
  tenantId?: string | null;
  agencyId?: string | null;
}

const OUTBOX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function outboxDoc(message: MailMessage) {
  const ref = getDb().collection("mailOutbox").doc();
  return {
    ref,
    data: {
      ...message,
      tenantId: message.tenantId ?? null,
      agencyId: message.agencyId ?? null,
      status: "queued",
      attempts: 0,
      createdAt: FieldValue.serverTimestamp(),
      expireAt: Timestamp.fromMillis(Date.now() + OUTBOX_TTL_MS),
    },
  };
}

export function queueMail(writer: Transaction | WriteBatch, message: MailMessage): string {
  const { ref, data } = outboxDoc(message);
  (writer as WriteBatch).create(ref, data);
  return ref.id;
}

export async function queueMailNow(message: MailMessage): Promise<string> {
  const { ref, data } = outboxDoc(message);
  await ref.create(data);
  return ref.id;
}

/**
 * Local/test delivery: render and "send" queued messages with the console provider right away
 * (hosted environments deliver from a Cloud Function). No-op for other providers.
 */
export async function deliverQueuedMailToConsole(): Promise<number> {
  if (getServerEnv().EMAIL_PROVIDER !== "console") return 0;
  const { deliverQueuedMail } = await import("./mail-delivery");
  return deliverQueuedMail();
}
