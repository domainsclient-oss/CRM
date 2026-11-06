import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Skeleton } from "@crm/ui/components/skeleton";
import { getUsageSummary } from "@crm/core/config/usage";
import { t, type MessageKey } from "@crm/shared/i18n";
import { can, requireCtx } from "@/features/records/data";

export const metadata: Metadata = {
  title: t("usage.title"),
  robots: { index: false, follow: false },
};

export default function UsagePage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" aria-label={t("common.loading")} />}>
      <Content />
    </Suspense>
  );
}

const UNLIMITED = 1_000_000_000;

// FR-PLAN-002: seats and records against plan limits.
async function Content() {
  const ctx = await requireCtx();
  if (!ctx) return null;
  if (!can(ctx, "plan.read")) notFound();
  const usage = await getUsageSummary(ctx);
  const rows = [
    ["usage.seats", usage.seats],
    ["usage.records", usage.records],
  ] as const;
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("usage.title")}</h1>
      <p>{t("usage.plan", { plan: t(`usage.plan.${usage.planId}` as MessageKey) })}</p>
      {rows.map(([label, { used, limit }]) => {
        const unlimited = limit >= UNLIMITED;
        const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
        return (
          <div key={label} className="flex flex-col gap-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium">{t(label)}</span>
              <span>
                {unlimited
                  ? t("usage.unlimited", { used })
                  : t("usage.of", { used, limit: limit.toLocaleString() })}
              </span>
            </div>
            {unlimited ? null : (
              <div
                role="progressbar"
                aria-label={t(label)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                className="h-2 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={`h-full ${pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-amber-500" : "bg-primary"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
      {usage.level !== "ok" ? (
        <p role="status" className="text-sm">
          {usage.level === "exceeded" ? t("usage.exceeded") : t("usage.warning")}
        </p>
      ) : null}
    </div>
  );
}
