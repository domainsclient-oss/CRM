import Link from "next/link";
import type { TenantContext } from "@crm/core/contexts/tenant";
import { listTimeline } from "@crm/core/records/activities";
import { SafeMarkdown } from "@crm/ui/components/safe-markdown";
import { workspaceScope } from "@crm/shared/permissions";
import { t, type MessageKey } from "@crm/shared/i18n";
import type { RelatedType } from "@crm/shared/records/schemas";
import { dayKey, timeKey } from "@crm/shared/records/time";
import { ActivityComposer, DeleteActivityButton } from "./activity-composer";
import { enumLabel } from "./config";
import { getFormatters, getMemberNames, stageNames } from "./data";

// Timeline (FR-ACT-001/002): newest first, cursor-paginated via the `tl` URL param. System
// entries are visually distinct and not editable. Bodies render through SafeMarkdown only.

type Activity = Record<string, unknown> & { id: string };

function systemText(a: Activity, stages: Record<string, string>): string {
  const event = String(a.systemEvent);
  const meta = (a.metadata as Record<string, string | null> | undefined) ?? {};
  const key = `timeline.event.${event}` as MessageKey;
  if (event === "deal.stage_changed") {
    return t(key, {
      from: stages[meta.from ?? ""] ?? "—",
      to: stages[meta.to ?? ""] ?? "—",
    });
  }
  if (event === "contact.lifecycle_changed") {
    return t(key, { from: enumLabel("stage", meta.from), to: enumLabel("stage", meta.to) });
  }
  return t(key);
}

export async function Timeline({
  ctx,
  type,
  id,
  cursor,
  basePath,
}: {
  ctx: TenantContext;
  type: RelatedType;
  id: string;
  cursor: string | null;
  basePath: string;
}) {
  const [page, fmt, members, stages] = await Promise.all([
    listTimeline(ctx, type, id, cursor),
    getFormatters(ctx),
    getMemberNames(ctx),
    stageNames(ctx),
  ]);
  const canLog = workspaceScope(ctx.role, "record.create") !== null;
  const canDeleteAny = workspaceScope(ctx.role, "record.delete") === "all";
  const now = new Date();

  return (
    <section aria-labelledby="timeline-heading" className="flex flex-col gap-4">
      <h2 id="timeline-heading" className="text-lg font-medium">
        {t("timeline.title")}
      </h2>
      {canLog ? (
        <ActivityComposer
          related={{ type, id }}
          today={dayKey(now, fmt.timeZone)}
          now={timeKey(now, fmt.timeZone)}
        />
      ) : null}
      {page.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("timeline.empty")}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {page.items.map((a) => {
            const system = a.type === "system";
            const subject = String(a.subject ?? "");
            const author = members[String(a.createdBy)] ?? "—";
            return (
              <li
                key={a.id}
                className={
                  system
                    ? "rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground"
                    : "rounded-lg border px-3 py-2"
                }
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className={system ? "" : "font-medium"}>
                    <span className="me-2 text-xs tracking-wide text-muted-foreground uppercase">
                      {t(`timeline.type.${String(a.type)}` as MessageKey)}
                    </span>
                    {system ? systemText(a, stages) : subject}
                  </p>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <time dateTime={String(a.occurredAt ?? "")}>{fmt.dateTime(a.occurredAt)}</time>
                    {" · "}
                    {author}
                    {!system && (canDeleteAny || a.createdBy === ctx.uid) ? (
                      <DeleteActivityButton id={a.id} subject={subject} />
                    ) : null}
                  </span>
                </div>
                {!system && a.body ? (
                  <SafeMarkdown source={String(a.body)} className="mt-1 text-sm break-words" />
                ) : null}
                {!system && (a.durationMinutes || a.outcome) ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[a.durationMinutes ? `${String(a.durationMinutes)} min` : null, a.outcome]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <div className="flex gap-4 text-sm">
        {cursor ? (
          <Link href={basePath} className="underline underline-offset-4">
            {t("timeline.newest")}
          </Link>
        ) : null}
        {page.nextCursor ? (
          <Link
            href={`${basePath}?tl=${encodeURIComponent(page.nextCursor)}`}
            className="underline underline-offset-4"
          >
            {t("timeline.more")}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
