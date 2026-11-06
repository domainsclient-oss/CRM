import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Skeleton } from "@crm/ui/components/skeleton";
import { getGatewaySettings } from "@crm/core/payments";
import { agencyAllows } from "@crm/shared/permissions";
import { t } from "@crm/shared/i18n";
import { GatewayForm, PlanPrices } from "@/components/billing-forms";
import { ConsoleShell, NoAccess, agencyNav } from "@/components/console-shell";
import {
  configureGatewayAction,
  removePlanPriceAction,
  setPlanPriceAction,
} from "@/features/agency/actions";
import { getAgencyAccess } from "@/server/access";

export const metadata: Metadata = {
  title: t("console.billing.title"),
  robots: { index: false, follow: false },
};

export default function AgencyBillingPage() {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96" aria-label={t("common.loading")} />}>
      <Content />
    </Suspense>
  );
}

// FR-BILL-001: the agency's own gateway account and plan price mapping.
async function Content() {
  const access = await getAgencyAccess();
  if (access.status === "unauthenticated") redirect("/login");
  if (access.status !== "ok") return <NoAccess />;
  const { ctx } = access;
  const settings = await getGatewaySettings(ctx);
  const canManage = agencyAllows(ctx.role, "agency.billing.manage");
  const marketing = process.env.APP_MARKETING_HOST ?? "localhost:3000";
  const scheme = marketing.includes("localhost") ? "http" : "https";
  const webhookUrlBase = `${scheme}://${marketing}/api/webhooks`;

  return (
    <ConsoleShell title={`${t("console.agency.title")} · ${ctx.agency.name}`} nav={agencyNav()}>
      <h1 className="text-2xl font-semibold">{t("console.billing.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("console.billing.body")}</p>
      <section aria-labelledby="gw-heading" className="flex flex-col gap-3">
        <h2 id="gw-heading" className="text-lg font-medium">
          {t("console.billing.gateway")}
        </h2>
        <p role="status" className="text-sm">
          {settings.configured && settings.provider
            ? t("console.billing.current", {
                provider: settings.provider,
                env: t(`console.billing.env.${settings.env}`),
                hint: settings.keyIdHint ?? "—",
              })
            : t("console.billing.none")}
        </p>
        {canManage ? (
          <GatewayForm action={configureGatewayAction} webhookUrlBase={`${webhookUrlBase}`} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("console.billing.ownerOnly")}</p>
        )}
      </section>
      {settings.configured ? (
        <section aria-labelledby="prices-heading" className="flex flex-col gap-3">
          <h2 id="prices-heading" className="text-lg font-medium">
            {t("console.billing.prices")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("console.billing.pricesBody")}</p>
          {canManage ? (
            <PlanPrices
              prices={settings.prices}
              setAction={setPlanPriceAction}
              removeAction={removePlanPriceAction}
            />
          ) : null}
        </section>
      ) : null}
    </ConsoleShell>
  );
}
