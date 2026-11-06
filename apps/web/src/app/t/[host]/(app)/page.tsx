import { Suspense } from "react";
import Link from "next/link";
import { Skeleton } from "@crm/ui/components/skeleton";
import { getDashboard } from "@crm/core/reports";
import { workspaceScope } from "@crm/shared/permissions";
import { t, type MessageKey } from "@crm/shared/i18n";
import { getFormatters, getMemberNames, requireCtx } from "@/features/records/data";
import { OwnerFilter } from "@/features/data/owner-filter";
import { BarTable } from "@/features/data/bar-table";

// Dashboard (FR-DASH-001/002): aggregation-only KPIs; Members see their own data, other roles the
// workspace with an optional owner filter. A failing widget shows an inline error.

export default async function DashboardPage(props: PageProps<"/t/[host]">) {
  const q = await props.searchParams;
  const owner =
    typeof q.owner === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(q.owner) ? q.owner : null;
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" aria-label={t("common.loading")} />}>
      <Content owner={owner} />
    </Suspense>
  );
}

function Widget({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 rounded-xl border p-4">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

const failed = (
  <p role="alert" className="text-sm text-destructive">
    {t("dash.widgetError")}
  </p>
);

async function Content({ owner }: { owner: string | null }) {
  const ctx = await requireCtx();
  if (!ctx) return null;
  if (!workspaceScope(ctx.role, "report.read")) return null;
  const [d, fmt, members] = await Promise.all([
    getDashboard(ctx, { ownerUid: owner }),
    getFormatters(ctx),
    getMemberNames(ctx),
  ]);
  const workspaceWide = workspaceScope(ctx.role, "report.read") === "all";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {t("app.dashboard.welcome", { workspace: ctx.tenant.name })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("app.dashboard.role", { role: ctx.role })}
          </p>
        </div>
        {workspaceWide ? <OwnerFilter members={members} current={owner} /> : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Widget title={t("dash.won")}>
          {d.wonThisMonth && d.wonLastMonth ? (
            <>
              <p className="text-2xl font-semibold tabular-nums">{fmt.money(d.wonThisMonth.sum)}</p>
              <p className="text-sm">
                {t("dash.wonThisMonth", {
                  count: d.wonThisMonth.count,
                  sum: fmt.money(d.wonThisMonth.sum),
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("dash.wonLastMonth", {
                  count: d.wonLastMonth.count,
                  sum: fmt.money(d.wonLastMonth.sum),
                })}
              </p>
            </>
          ) : (
            failed
          )}
        </Widget>
        <Widget title={t("dash.newLeads")}>
          {d.newLeadsThisMonth !== null ? (
            <p className="text-2xl font-semibold tabular-nums">{d.newLeadsThisMonth}</p>
          ) : (
            failed
          )}
        </Widget>
        <Widget title={t("dash.conversion")}>
          {d.conversion ? (
            <p className="text-2xl font-semibold tabular-nums">
              {t("dash.conversionValue", {
                rate: d.conversion.rate,
                converted: d.conversion.converted,
                total: d.conversion.total,
              })}
            </p>
          ) : (
            failed
          )}
        </Widget>
        <Widget title={t("dash.myTasks")}>
          {d.myTasksDue !== null ? (
            <Link href="/my-tasks" className="text-lg underline underline-offset-4">
              {t("dash.dueToday", { count: d.myTasksDue })}
            </Link>
          ) : (
            failed
          )}
        </Widget>
        <div className="md:col-span-2">
          <Widget title={t("dash.pipeline")}>
            {d.pipeline ? (
              <BarTable
                caption={t("dash.pipeline")}
                columns={[t("dash.stage"), t("dash.count"), t("dash.value")]}
                rows={d.pipeline.map((s) => ({
                  key: s.stageId,
                  cells: [s.stage, s.count, fmt.money(s.sum)],
                  bar: s.sum,
                }))}
              />
            ) : (
              failed
            )}
          </Widget>
        </div>
        <Widget title={t("dash.recent")}>
          {d.recent ? (
            d.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("timeline.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {d.recent.map((a) => (
                  <li key={a.id} className="flex flex-col">
                    <span>
                      {a.type === "system"
                        ? t(`timeline.event.${a.systemEvent}` as MessageKey, { from: "", to: "" })
                        : a.subject}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {fmt.dateTime(a.occurredAt)} · {a.related.map((r) => r.label).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            failed
          )}
        </Widget>
      </div>
    </div>
  );
}
