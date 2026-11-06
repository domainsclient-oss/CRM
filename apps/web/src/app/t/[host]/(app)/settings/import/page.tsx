import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@crm/ui/components/skeleton";
import { listJobs } from "@crm/core/jobs";
import { t, type MessageKey } from "@crm/shared/i18n";
import { can, getFormatters, requireCtx } from "@/features/records/data";
import { TenantExportButton } from "@/features/data/danger-zone";
import { ImportWizard } from "@/features/data/import-wizard";

export const metadata: Metadata = {
  title: t("import.title"),
  robots: { index: false, follow: false },
};

export default function ImportPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" aria-label={t("common.loading")} />}>
      <Content />
    </Suspense>
  );
}

// Import wizard (Manager+), recent jobs with downloads, full export (Owner).
async function Content() {
  const ctx = await requireCtx();
  if (!ctx) return null;
  const [jobs, fmt] = await Promise.all([listJobs(ctx), getFormatters(ctx)]);
  return (
    <div className="flex flex-col gap-8">
      {can(ctx, "import.run") ? (
        <section className="flex flex-col gap-3" aria-labelledby="import-heading">
          <h1 id="import-heading" className="text-2xl font-semibold">
            {t("import.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("import.body")}</p>
          <ImportWizard />
        </section>
      ) : null}
      {can(ctx, "tenant.export") ? <TenantExportButton /> : null}
      <section className="flex flex-col gap-3" aria-labelledby="jobs-heading">
        <h2 id="jobs-heading" className="text-lg font-medium">
          {t("import.jobs")}
        </h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("console.empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {jobs.map((j) => (
              <li
                key={j.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                data-job={j.id}
              >
                <div className="flex flex-col">
                  <span className="font-medium">{j.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {fmt.dateTime(j.createdAt)} · {t(`import.status.${j.status}` as MessageKey)} ·{" "}
                    {t("import.progress", {
                      processed: j.progress.processed,
                      total: j.progress.total,
                      failed: j.progress.failed,
                    })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {j.downloadable
                    ? j.files.map((f) => (
                        <a
                          key={f.name}
                          href={`/api/files/${j.id}/${encodeURIComponent(f.name)}`}
                          className="underline underline-offset-4"
                          download
                        >
                          {t("import.download", { file: f.name })}
                        </a>
                      ))
                    : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
