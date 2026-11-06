import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getDb } from "../firebase-admin";
import { logger } from "../logger";
import { notify } from "../notifications";

// Task due reminders (FR-TASK-003): scheduled every few minutes (Cloud Functions; inline in tests).
// System job → collection-group query; the tenant comes from each task's path. Exactly-once per
// (task, due time): the reminder key is claimed in a transaction before notifying, and editing the
// due date resets `reminderSentAt` (records/tasks.ts), which re-arms the reminder.

export async function sendTaskReminders(now = new Date(), limit = 200): Promise<number> {
  const snap = await getDb()
    .collectionGroup("tasks")
    .where("isDeleted", "==", false)
    .where("status", "==", "open")
    .where("reminderSentAt", "==", null)
    .where("reminderAt", "<=", Timestamp.fromDate(now))
    .orderBy("reminderAt", "asc")
    .limit(limit)
    .get();
  let sent = 0;
  for (const doc of snap.docs) {
    const tenantId = doc.ref.parent.parent?.id;
    if (!tenantId || doc.get("tenantId") !== tenantId) continue; // path is authoritative
    const claim = await getDb().runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      const data = fresh.data();
      if (!data || data.reminderSentAt || data.status !== "open" || data.isDeleted) return null;
      const dueAt = data.dueAt as Timestamp | null;
      tx.update(doc.ref, {
        reminderSentAt: FieldValue.serverTimestamp(),
        reminderKey: `${doc.id}:${dueAt?.toMillis() ?? "none"}`,
      });
      return { assignee: String(data.assigneeUid), title: String(data.title) };
    });
    if (!claim) continue;
    await notify({
      tenantId,
      recipientUid: claim.assignee,
      type: "task_due",
      title: claim.title,
      link: `/tasks/${doc.id}`,
    });
    sent++;
  }
  if (sent) logger.info("task_reminders_sent", { sent });
  return sent;
}
