import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Skeleton } from "@crm/ui/components/skeleton";
import {
  activitiesByUser,
  leadSourceConversion,
  pipelineByStage,
  wonLostByMonth,
} from "@crm/core/reports";
import { dayKey } from "@crm/shared/records/time";
import { workspaceScope } from "@crm/shared/permissions";
import { t } from "@crm/shared/i18n";
import { enumLabel } from "@/features/records/config";
import { getFormatters, getMemberNames, requireCtx } from "@/features/records/data";
import { BarTable } from "@/features/data/bar-table";
import { CsvButton } from "@/features/data/csv-button";
import { OwnerFilter } from "@/features/data/owner-filter";
import { RangeForm } from "@/features/data/range-form";

export const metadata: Metadata = {
  title: t("reports.title"),
  robots: { index: false, follow: false },
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReportsPage(props: PageProps<"/t/[host]/reports">) {
  const q = await props.searchParams;
  const pick = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : null);
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" aria-label={t("common.loading")} />}>
      <Content owner={pick("owner")} from={pick("from")} to={pick("to")} />
    </Suspense>
  );
}

function Report({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

// FR-RPT-001/002: four standard reports, ranges in the workspace time zone, CSV for Manager+.
async function Content({
  owner,
  from,
  to,
}: {
  owner: string | null;
  from: string | null;
  to: string | null;
}) {
  const ctx = await requireCtx();
  if (!ctx) return null;
  if (!workspaceScope(ctx.role, "report.read")) notFound();
  const fmt = await getFormatters(ctx);
  const today = dayKey(new Date(), fmt.timeZone);
  const range = {
    from: from && DATE.test(from) ? from : `${today.slice(0, 4)}-01-01`,
    to: to && DATE.test(to) ? to : today,
  };
  const scope = { ownerUid: owner && /^[A-Za-z0-9_-]{1,64}$/.test(owner) ? owner : null };
  const members = await getMemberNames(ctx);
  const memberList = Object.entries(members).map(([uid, name]) => ({ uid, name }));
  const [pipeline, months, sources, activities] = await Promise.all([
    pipelineByStage(ctx, scope),
    wonLostByMonth(ctx, scope),
    leadSourceConversion(ctx, scope, range).catch(() => null),
    activitiesByUser(ctx, range, memberList).catch(() => null),
  ]);
  const canExport = workspaceScope(ctx.role, "report.export") !== null;
  const workspaceWide = workspaceScope(ctx.role, "report.read") === "all";

  const pipelineRows = pipeline.map((s) => [s.stage, s.count, fmt.money(s.sum)]);
  const monthRows = months.map((m) => [m.month, m.won, fmt.money(m.wonValue), m.lost]);
  const sourceRows = (sources ?? []).map((s) => [
    enumLabel("source", s.source),
    s.leads,
    s.converted,
    `${s.rate}%`,
  ]);
  const activityRows = (activities ?? []).map((a) => [a.name, a.call, a.meeting, a.email, a.note]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("reports.title")}</h1>
        <div className="flex flex-wrap items-end gap-3">
          {workspaceWide ? <OwnerFilter members={members} current={scope.ownerUid} /> : null}
          <RangeForm from={range.from} to={range.to} />
        </div>
      </div>
      {sources === null ? (
        <p role="alert" className="text-sm text-destructive">
          {t("reports.rangeError")}
        </p>
      ) : null}

      <Report title={t("reports.pipeline")}>
        <BarTable
          caption={t("reports.pipeline")}
          columns={[t("dash.stage"), t("dash.count"), t("dash.value")]}
          rows={pipeline.map((s, i) => ({ key: s.stageId, cells: pipelineRows[i]!, bar: s.sum }))}
        />
        {canExport ? (
          <CsvButton
            name="pipeline.csv"
            header={[t("dash.stage"), t("dash.count"), t("dash.value")]}
            rows={pipelineRows}
          />
        ) : null}
      </Report>

      <Report title={t("reports.wonLost")}>
        <BarTable
          caption={t("reports.wonLost")}
          columns={[t("reports.month"), t("reports.won"), t("reports.wonValue"), t("reports.lost")]}
          rows={months.map((m, i) => ({ key: m.month, cells: monthRows[i]!, bar: m.won }))}
        />
        {canExport ? (
          <CsvButton
            name="won-lost.csv"
            header={[
              t("reports.month"),
              t("reports.won"),
              t("reports.wonValue"),
              t("reports.lost"),
            ]}
            rows={monthRows}
          />
        ) : null}
      </Report>

      {sources ? (
        <Report title={t("reports.sources")}>
          <BarTable
            caption={t("reports.sources")}
            columns={[
              t("reports.source"),
              t("reports.leads"),
              t("reports.converted"),
              t("reports.rate"),
            ]}
            rows={sources.map((s, i) => ({ key: s.source, cells: sourceRows[i]!, bar: s.leads }))}
          />
          {canExport ? (
            <CsvButton
              name="lead-sources.csv"
              header={[
                t("reports.source"),
                t("reports.leads"),
                t("reports.converted"),
                t("reports.rate"),
              ]}
              rows={sourceRows}
            />
          ) : null}
        </Report>
      ) : null}

      {activities ? (
        <Report title={t("reports.activities")}>
          <BarTable
            caption={t("reports.activities")}
            columns={[
              t("reports.user"),
              t("timeline.type.call"),
              t("timeline.type.meeting"),
              t("timeline.type.email"),
              t("timeline.type.note"),
            ]}
            rows={activities.map((a, i) => ({
              key: a.uid,
              cells: activityRows[i]!,
              bar: a.call + a.meeting + a.email + a.note,
            }))}
          />
          {canExport ? (
            <CsvButton
              name="activities.csv"
              header={[
                t("reports.user"),
                t("timeline.type.call"),
                t("timeline.type.meeting"),
                t("timeline.type.email"),
                t("timeline.type.note"),
              ]}
              rows={activityRows}
            />
          ) : null}
        </Report>
      ) : null}
    </div>
  );
}
