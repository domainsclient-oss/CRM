import "server-only";
import { FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import type { TaskInput } from "@crm/shared/records/schemas";
import { addDays, dayKey, isValidTimeZone, zonedToUtc } from "@crm/shared/records/time";
import { authorize } from "../authz";
import type { TenantContext } from "../contexts/tenant-context";
import { ConflictError } from "../errors";
import { getDb } from "../firebase-admin";
import { getById, tenantCollection } from "../repositories/base";
import { auditRecord, loadForWrite, loadReference, systemActivity, touchFields } from "./common";
import { toPlain } from "./plain";
import { saveRecord, type SaveTarget } from "./save";

// Tasks (FR-TASK-001/002). Owner = assignee. Due dates are entered in the actor's time zone and
// stored in UTC; date-only tasks keep their calendar day (`dueDate`) for grouping and display.

async function userTimeZone(
  tx: Transaction | null,
  ctx: TenantContext,
  uid: string,
): Promise<string> {
  const ref = getDb().doc(`users/${uid}`);
  const tz = (tx ? await tx.get(ref) : await ref.get()).get("timezone") as string | undefined;
  return tz && isValidTimeZone(tz) ? tz : ctx.tenant.settings.timezone || "UTC";
}

export function viewerTimeZone(ctx: TenantContext): Promise<string> {
  return userTimeZone(null, ctx, ctx.uid);
}

export function saveTask(ctx: TenantContext, target: SaveTarget, input: TaskInput) {
  return saveRecord(ctx, "task", target, async (tx, existing) => {
    const assignee = input.assigneeUid ?? (existing?.assigneeUid as string | undefined) ?? ctx.uid;
    const [actorTz, assigneeTz] = await Promise.all([
      userTimeZone(tx, ctx, ctx.uid),
      assignee === ctx.uid ? null : userTimeZone(tx, ctx, assignee),
    ]);
    let related = null;
    if (input.related) {
      const same =
        existing?.related?.type === input.related.type && existing.related.id === input.related.id;
      related = same
        ? existing!.related
        : {
            ...input.related,
            label: (await loadReference(tx, ctx, input.related.type, input.related.id, "related"))
              .label,
          };
    }
    const dueIsDateOnly = Boolean(input.dueDate && !input.dueTime);
    const dueAt = input.dueDate
      ? Timestamp.fromDate(zonedToUtc(input.dueDate, input.dueTime ?? "00:00", actorTz))
      : null;
    const reminderAt = !input.dueDate
      ? null
      : dueIsDateOnly
        ? Timestamp.fromDate(zonedToUtc(input.dueDate, "09:00", assigneeTz ?? actorTz))
        : dueAt;
    const dueChanged =
      !existing || existing.dueDate !== input.dueDate || existing.dueTime !== input.dueTime;
    return {
      fields: {
        title: input.title,
        description: input.description,
        dueDate: input.dueDate,
        dueTime: input.dueTime,
        dueAt,
        dueIsDateOnly,
        dueTimeZone: input.dueDate ? actorTz : null,
        priority: input.priority,
        related,
        reminderAt,
        ...(dueChanged ? { reminderSentAt: null } : {}),
        ...(existing ? {} : { status: "open", completedAt: null }),
      },
      owner: input.assigneeUid,
    };
  });
}

export async function getTask(ctx: TenantContext, id: string) {
  const doc = await getById(ctx, "tasks", id);
  return toPlain(doc) as Record<string, unknown> & { id: string; updatedAt: string };
}

/** FR-TASK-001: assignee (own scope) or Manager+ completes/reopens. */
export async function setTaskDone(ctx: TenantContext, id: string, done: boolean) {
  authorize(ctx, "record.update");
  return getDb().runTransaction(async (tx) => {
    const { ref, data } = await loadForWrite(tx, ctx, "tasks", id, "record.update");
    if ((data.status === "done") === done) throw new ConflictError(done ? "already_done" : "open");
    tx.update(ref, {
      status: done ? "done" : "open",
      completedAt: done ? FieldValue.serverTimestamp() : null,
      ...touchFields(ctx),
    });
    const related = data.related as {
      type: "company" | "contact" | "lead" | "deal";
      id: string;
      label: string;
    } | null;
    if (related) {
      systemActivity(tx, ctx, done ? "task.completed" : "task.reopened", [related], { taskId: id });
    }
    auditRecord(tx, ctx, done ? "task.completed" : "task.reopened", { type: "task", id });
    return { id, done };
  });
}

const myOpenTasks = (ctx: TenantContext) =>
  tenantCollection(ctx, "tasks")
    .where("isDeleted", "==", false)
    .where("assigneeUid", "==", ctx.uid)
    .where("status", "==", "open");

/** FR-TASK-002: the actor's open tasks (grouped by the UI in the viewer's zone). */
export async function listMyTasks(
  ctx: TenantContext,
): Promise<Array<Record<string, unknown> & { id: string }>> {
  authorize(ctx, "record.read");
  const snap = await myOpenTasks(ctx).orderBy("dueAt", "asc").limit(200).get();
  return snap.docs.map((d) => ({ ...(toPlain(d.data()) as Record<string, unknown>), id: d.id }));
}

/** Navigation badge: open tasks due today or earlier in the viewer's zone (count aggregation). */
export async function myDueTaskCount(ctx: TenantContext): Promise<number> {
  if (ctx.role === "viewer") return 0;
  const tz = await viewerTimeZone(ctx);
  const tomorrow = addDays(dayKey(new Date(), tz), 1);
  const end = Timestamp.fromDate(zonedToUtc(tomorrow, "00:00", tz));
  const snap = await myOpenTasks(ctx).where("dueAt", "<", end).count().get();
  return snap.data().count;
}
