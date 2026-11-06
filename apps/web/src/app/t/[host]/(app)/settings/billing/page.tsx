import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Skeleton } from "@crm/ui/components/skeleton";
import { getBillingOverview } from "@crm/core/payments";
import { formatMoney } from "@crm/shared/records/money";
import { t, type MessageKey } from "@crm/shared/i18n";
import { CancelSubscriptionButton, SubscribeButton } from "@/features/billing/billing-controls";
import { can, getFormatters, requireCtx } from "@/features/records/data";

export const metadata: Metadata = {
  title: t("billing.title"),
  robots: { index: false, follow: false },
};

export default function BillingPage(props: PageProps<"/t/[host]/settings/billing">) {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" aria-label={t("common.loading")} />}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}

// FR-BILL-004: plan, status, next billing date and payment history; subscribe via hosted checkout.
async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/t/[host]/settings/billing">["searchParams"];
}) {
  const ctx = await requireCtx();
  if (!ctx) return null;
  if (!can(ctx, "billing.read")) notFound();
  const [billing, fmt, params] = await Promise.all([
    getBillingOverview(ctx),
    getFormatters(ctx),
    searchParams,
  ]);
  const plan = (id: string) => t(`usage.plan.${id}` as MessageKey);
  const date = (iso: string | null) => (iso ? fmt.date(iso) : "—");
  const subscribed = billing.status === "active" || billing.status === "past_due";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("billing.title")}</h1>
      {params.checkout === "done" ? (
        <p role="status" className="rounded-lg border p-3 text-sm">
          {t("billing.checkoutDone")}
        </p>
      ) : null}
      <section
        aria-labelledby="billing-current"
        className="flex flex-col gap-1 rounded-xl border p-4"
      >
        <h2 id="billing-current" className="text-lg font-medium">
          {t("billing.plan", { plan: plan(billing.planId) })}
        </h2>
        <p>
          {t("billing.status", {
            status: t(`billing.state.${billing.billingState}` as MessageKey),
          })}
        </p>
        {billing.mode === "manual" && billing.paidUntil ? (
          <p className="text-sm text-muted-foreground">
            {t("billing.paidUntil", { date: date(billing.paidUntil) })}
          </p>
        ) : null}
        {billing.currentPeriodEnd ? (
          <p className="text-sm text-muted-foreground">
            {billing.cancelAtPeriodEnd || billing.status === "cancelled"
              ? t("billing.endsOn", { date: date(billing.currentPeriodEnd) })
              : t("billing.renews", { date: date(billing.currentPeriodEnd) })}
          </p>
        ) : null}
        {billing.canManage && subscribed && !billing.cancelAtPeriodEnd ? (
          <div className="mt-2">
            <CancelSubscriptionButton />
          </div>
        ) : null}
      </section>

      {!subscribed ? (
        <section aria-labelledby="billing-choose" className="flex flex-col gap-3">
          <h2 id="billing-choose" className="text-lg font-medium">
            {t("billing.choose")}
          </h2>
          {billing.mode !== "gateway" || billing.prices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("billing.noGateway")}</p>
          ) : (
            <>
              <ul className="grid gap-3 sm:grid-cols-2">
                {billing.prices.map((p) => (
                  <li key={p.planId} className="flex flex-col gap-2 rounded-xl border p-4">
                    <span className="font-medium">{plan(p.planId)}</span>
                    <span className="text-sm">
                      {t("billing.price", {
                        amount: formatMoney(p.amount, p.currency, fmt.locale),
                        interval: t(`billing.interval.${p.interval}` as MessageKey),
                      })}
                    </span>
                    {billing.canManage ? (
                      <SubscribeButton
                        planId={p.planId as "starter" | "growth" | "enterprise"}
                        label={t("billing.subscribe", { plan: plan(p.planId) })}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                {billing.canManage ? t("billing.secure") : t("billing.ownerOnly")}
              </p>
            </>
          )}
        </section>
      ) : null}

      <section aria-labelledby="billing-history" className="flex flex-col gap-2">
        <h2 id="billing-history" className="text-lg font-medium">
          {t("billing.history")}
        </h2>
        {billing.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("billing.historyEmpty")}</p>
        ) : (
          <div
            className="overflow-x-auto rounded-xl border"
            role="region"
            tabIndex={0}
            aria-label={t("billing.history")}
          >
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    {t("billing.col.date")}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t("billing.col.amount")}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t("billing.col.status")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {billing.history.map((h) => (
                  <tr key={h.id} className="border-t">
                    <td className="px-3 py-2">
                      <time dateTime={h.occurredAt}>{date(h.occurredAt)}</time>
                    </td>
                    <td className="px-3 py-2">
                      {h.currency ? formatMoney(h.amount, h.currency, fmt.locale) : "—"}
                    </td>
                    <td className="px-3 py-2">{h.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
