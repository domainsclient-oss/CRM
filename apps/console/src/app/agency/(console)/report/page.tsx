import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Skeleton } from "@crm/ui/components/skeleton";
import { agencyUsageReport } from "@crm/core/services/agency-admin";
import { t, type MessageKey } from "@crm/shared/i18n";
import { ConsoleShell, NoAccess, agencyNav } from "@/components/console-shell";
import { ReportCsvButton } from "@/components/report-csv-button";
import { usageReportCsvAction } from "@/features/agency/actions";
import { getAgencyAccess } from "@/server/access";

export const metadata: Metadata = {
  title: t("console.report"),
  robots: { index: false, follow: false },
};

export default function AgencyReportPage() {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96" aria-label={t("common.loading")} />}>
      <Content />
    </Suspense>
  );
}

const UNLIMITED = 1_000_000_000;
const limit = (n: number) => (n >= UNLIMITED ? "∞" : n.toLocaleString());

// FR-AGY-006: aggregate metrics per workspace — never CRM content.
async function Content() {
  const access = await getAgencyAccess();
  if (access.status === "unauthenticated") redirect("/login");
  if (access.status !== "ok") return <NoAccess />;
  const { ctx } = access;
  const rows = await agencyUsageReport(ctx);
  const headers = [
    t("console.col.name"),
    t("console.col.status"),
    t("console.detail.plan"),
    t("console.detail.billing"),
    t("console.detail.seats"),
    t("console.detail.records"),
    t("console.report.activeUsers"),
  ];
  return (
    <ConsoleShell title={`${t("console.agency.title")} · ${ctx.agency.name}`} nav={agencyNav()}>
      <h1 className="text-2xl font-semibold">{t("console.report")}</h1>
      <p className="text-sm text-muted-foreground">{t("console.report.body")}</p>
      <ReportCsvButton action={usageReportCsvAction} />
      <div
        className="overflow-x-auto rounded-xl border"
        role="region"
        tabIndex={0}
        aria-label={t("console.report")}
      >
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              {headers.map((h) => (
                <th key={h} scope="col" className="px-3 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {r.name}
                </th>
                <td className="px-3 py-2">{t(`console.status.${r.status}` as MessageKey)}</td>
                <td className="px-3 py-2">{t(`usage.plan.${r.planId}` as MessageKey)}</td>
                <td className="px-3 py-2">{r.billingState}</td>
                <td className="px-3 py-2 tabular-nums">
                  {r.seats} / {limit(r.seatLimit)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {r.records.toLocaleString()} / {limit(r.recordLimit)}
                </td>
                <td className="px-3 py-2 tabular-nums">{r.activeUsers30d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ConsoleShell>
  );
}
