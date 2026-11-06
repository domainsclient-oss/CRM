import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Button } from "@crm/ui/components/button";
import { Skeleton } from "@crm/ui/components/skeleton";
import { listMyTasks } from "@crm/core/records/tasks";
import { workspaceScope } from "@crm/shared/permissions";
import { t, type MessageKey } from "@crm/shared/i18n";
import { taskGroup, type TaskGroup } from "@crm/shared/records/time";
import { enumLabel } from "@/features/records/config";
import { getFormatters, requireCtx } from "@/features/records/data";
import { TaskDoneToggle } from "@/features/records/record-controls";

export const metadata: Metadata = {
  title: t("nav.myTasks"),
  robots: { index: false, follow: false },
};

const GROUPS: TaskGroup[] = ["overdue", "today", "next7", "later", "none"];

export default function MyTasksPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" aria-label={t("common.loading")} />}>
      <Content />
    </Suspense>
  );
}

// FR-TASK-002: open tasks assigned to me, grouped in my time zone.
async function Content() {
  const ctx = await requireCtx();
  if (!ctx) return null;
  const [tasks, fmt] = await Promise.all([listMyTasks(ctx), getFormatters(ctx)]);
  const now = new Date();
  const grouped = new Map<TaskGroup, typeof tasks>(GROUPS.map((g) => [g, []]));
  for (const task of tasks) {
    const group = taskGroup(
      {
        dueAt: typeof task.dueAt === "string" ? new Date(task.dueAt) : null,
        dueIsDateOnly: Boolean(task.dueIsDateOnly),
        dueDate: (task.dueDate as string | null) ?? null,
      },
      now,
      fmt.timeZone,
    );
    grouped.get(group)!.push(task);
  }
  const canUpdate = workspaceScope(ctx.role, "record.update") !== null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("nav.myTasks")}</h1>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/tasks">{t("nav.tasks")}</Link>
          </Button>
          {workspaceScope(ctx.role, "record.create") ? (
            <Button asChild>
              <Link href="/tasks/new">{t("entity.tasks.new")}</Link>
            </Button>
          ) : null}
        </div>
      </div>
      {tasks.length === 0 ? <p className="text-muted-foreground">{t("task.noneOpen")}</p> : null}
      {GROUPS.map((group) => {
        const items = grouped.get(group)!;
        if (items.length === 0) return null;
        return (
          <section key={group} aria-labelledby={`group-${group}`} className="flex flex-col gap-2">
            <h2
              id={`group-${group}`}
              className={`text-lg font-medium ${group === "overdue" ? "text-destructive" : ""}`}
            >
              {t(`task.group.${group}` as MessageKey)}{" "}
              <span className="text-sm text-muted-foreground">({items.length})</span>
            </h2>
            <ul className="flex flex-col divide-y rounded-xl border">
              {items.map((task) => {
                const title = String(task.title);
                const related = task.related as { label: string } | null;
                return (
                  <li key={task.id} className="flex items-start gap-3 px-3 py-2">
                    {canUpdate ? <TaskDoneToggle id={task.id} title={title} done={false} /> : null}
                    <div className="flex min-w-0 flex-col">
                      <Link
                        href={`/tasks/${task.id}`}
                        className="font-medium break-words underline-offset-4 hover:underline"
                      >
                        {title}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {[
                          task.dueDate
                            ? task.dueIsDateOnly
                              ? fmt.dateOnly(`${String(task.dueDate)}T00:00:00Z`)
                              : fmt.dateTime(task.dueAt)
                            : null,
                          enumLabel("priority", task.priority),
                          related?.label,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
