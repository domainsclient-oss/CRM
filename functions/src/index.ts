// Cloud Functions (2nd gen) for hosted environments (ADR-008, requirements/02 §11). Thin wiring
// only: every body lives in @crm/core and is idempotent, so a retried trigger or overlapping
// schedule never double-applies work. Tenant IDs come from document paths, never payloads.
// Deployed with the instance in T-01-09 (region = Firestore region; runtime service account).
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { reconcileUsage } from "@crm/core/config/usage";
import { runDomainChecks } from "@crm/core/domains/service";
import { getDb } from "@crm/core/firebase-admin";
import { logger } from "@crm/core/logger";
import { runJob, sendTaskReminders } from "@crm/core/jobs";
import { deliverQueuedMail } from "@crm/core/mail-delivery";
import { purgeExpiredTrash } from "@crm/core/records/trash";
import { purgeDueTenants } from "@crm/core/tenant-deletion";
import { applyPaymentEvent, reconcileBilling } from "@crm/core/payments";

const region = process.env.FUNCTIONS_REGION ?? "us-central1";
const emailProviderApiKey = defineSecret("EMAIL_PROVIDER_API_KEY");

/** Background jobs: import, exports, search backfill (one invocation per job document). */
export const onJobCreated = onDocumentCreated(
  { document: "tenants/{tenantId}/jobs/{jobId}", region, timeoutSeconds: 540, memory: "1GiB" },
  async (event) => {
    await runJob(event.params.tenantId, event.params.jobId);
  },
);

/** Transactional email outbox → Resend. */
export const onMailQueued = onDocumentCreated(
  { document: "mailOutbox/{id}", region, secrets: [emailProviderApiKey] },
  async () => {
    await deliverQueuedMail(20);
  },
);

/** Task due reminders (FR-TASK-003). */
export const taskReminders = onSchedule({ schedule: "every 5 minutes", region }, async () => {
  await sendTaskReminders();
});

/** Custom-domain verification (FR-TEN-005, 05 §5.1 step 4). */
export const domainChecks = onSchedule({ schedule: "every 10 minutes", region }, async () => {
  await runDomainChecks();
});

/**
 * Nightly maintenance: trash purge (30 days), usage reconciliation, tenant purge after the deletion
 * grace period, and resuming jobs stuck in "running" (crashed workers; bodies resume by cursor).
 */
export const nightly = onSchedule(
  { schedule: "every day 03:00", region, timeoutSeconds: 540, memory: "1GiB" },
  async () => {
    const db = getDb();
    let last: string | null = null;
    for (;;) {
      let q = db
        .collection("tenants")
        .where("status", "==", "active")
        .orderBy("__name__")
        .limit(100);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      for (const tenant of snap.docs) {
        await purgeExpiredTrash(tenant.id);
        await reconcileUsage(tenant.id);
        const stuck = await tenant.ref
          .collection("jobs")
          .where("status", "==", "running")
          .limit(20)
          .get();
        for (const job of stuck.docs) await runJob(tenant.id, job.id, { resume: true });
      }
      if (snap.size < 100) break;
      last = snap.docs.at(-1)!.id;
    }
    await purgeDueTenants();
  },
);

/** Verified payment webhooks → authoritative state from the gateway (FR-BILL-003). */
export const onPaymentEvent = onDocumentCreated(
  { document: "paymentEvents/{eventId}", region, retry: true },
  async (event) => {
    await applyPaymentEvent(event.params.eventId);
  },
);

/** Billing reconciliation (FR-BILL-003 AC5) + grace/expiry transitions (FR-BILL-002/005). */
export const billingReconciliation = onSchedule(
  { schedule: "every day 02:30", region, timeoutSeconds: 540 },
  async () => {
    const report = await reconcileBilling();
    if (report.drift > 0 || report.failed > 0) {
      logger.warn("payment.reconciliation_report", { ...report });
    }
  },
);
