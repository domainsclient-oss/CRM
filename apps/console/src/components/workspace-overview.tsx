import type { WorkspaceDetail } from "@crm/core/services/agency-admin";
import { t, type MessageKey } from "@crm/shared/i18n";

const UNLIMITED = 1_000_000_000;
const limit = (n: number) => (n >= UNLIMITED ? "∞" : n.toLocaleString());

/** Workspace metadata only (FR-AGY-005) — never CRM content. */
export function WorkspaceOverview({ w }: { w: WorkspaceDetail }) {
  const rows: Array<[MessageKey, string]> = [
    ["console.detail.status", t(`console.status.${w.status}` as MessageKey)],
    ["console.detail.host", w.canonicalHost],
    ["console.detail.plan", t(`usage.plan.${w.planId}` as MessageKey)],
    ["console.detail.billing", w.billingState],
    ["console.detail.seats", `${w.usage.seats} / ${limit(w.limits.seats)}`],
    ["console.detail.records", `${w.usage.records.toLocaleString()} / ${limit(w.limits.records)}`],
  ];
  return (
    <section aria-labelledby="overview-heading" className="flex flex-col gap-3">
      <h2 id="overview-heading" className="text-lg font-medium">
        {t("console.detail.overview")}
      </h2>
      <dl className="grid gap-3 sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{t(label)}</dt>
            <dd className="font-medium break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
