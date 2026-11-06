import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Skeleton } from "@crm/ui/components/skeleton";
import { brandAssetUrl, resolveBranding } from "@crm/core/branding/resolve";
import { listDomains } from "@crm/core/domains/service";
import { AppError } from "@crm/core/errors";
import { getWorkspaceDetail } from "@crm/core/services/agency-admin";
import { agencyAllows } from "@crm/shared/permissions";
import { t } from "@crm/shared/i18n";
import { ConsoleBranding } from "@/components/admin-forms";
import { ManualBillingForm } from "@/components/billing-forms";
import { ConsoleShell, NoAccess, agencyNav } from "@/components/console-shell";
import { DomainsManager } from "@/components/domains-manager";
import { WorkspaceOverview } from "@/components/workspace-overview";
import {
  addAgencySubdomainAction,
  addDomainAction,
  checkDomainAction,
  removeClientAssetAction,
  removeDomainAction,
  setManualBillingAction,
  setCanonicalDomainAction,
  updateClientBrandingAction,
  uploadClientAssetAction,
} from "@/features/agency/actions";
import { getAgencyAccess } from "@/server/access";

export const metadata: Metadata = {
  title: t("console.agency.title"),
  robots: { index: false, follow: false },
};

export default async function AgencyWorkspacePage(props: PageProps<"/agency/workspaces/[id]">) {
  const { id } = await props.params;
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96" aria-label={t("common.loading")} />}>
      <Content id={id} />
    </Suspense>
  );
}

async function Content({ id }: { id: string }) {
  const access = await getAgencyAccess();
  if (access.status === "unauthenticated") redirect("/login");
  if (access.status !== "ok") return <NoAccess />;
  const { ctx } = access;
  const actor = { kind: "agency" as const, ctx };
  const [workspace, domains] = await Promise.all([
    getWorkspaceDetail(actor, id),
    listDomains(actor, id),
  ]).catch((error: unknown) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const inherited = resolveBranding(ctx.agency, null);

  return (
    <ConsoleShell title={`${t("console.agency.title")} · ${ctx.agency.name}`} nav={agencyNav()}>
      <Link href="/" className="text-sm underline-offset-4 hover:underline">
        ← {t("console.back")}
      </Link>
      <h1 className="text-2xl font-semibold">{workspace.name}</h1>
      <WorkspaceOverview w={workspace} />
      {agencyAllows(ctx.role, "agency.workspace.domain") ? (
        <DomainsManager
          tenantId={id}
          domains={domains}
          actions={{
            add: addDomainAction,
            check: checkDomainAction,
            setCanonical: setCanonicalDomainAction,
            remove: removeDomainAction,
            ...(ctx.agency.baseDomain ? { addSubdomain: addAgencySubdomainAction } : {}),
          }}
        />
      ) : null}
      {agencyAllows(ctx.role, "agency.billing.manage") && workspace.billing.mode !== "gateway" ? (
        <section aria-labelledby="ws-billing-heading" className="flex flex-col gap-3">
          <h2 id="ws-billing-heading" className="text-lg font-medium">
            {t("console.billing.manual")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("console.billing.manualBody")}</p>
          <ManualBillingForm
            tenantId={id}
            planId={workspace.planId}
            paidUntil={workspace.billing.paidUntil}
            action={setManualBillingAction}
          />
        </section>
      ) : null}
      {agencyAllows(ctx.role, "agency.workspace.branding") ? (
        <section aria-labelledby="ws-branding-heading" className="flex flex-col gap-3">
          <h2 id="ws-branding-heading" className="text-lg font-medium">
            {t("console.detail.branding")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {workspace.allowWorkspaceBranding
              ? t("console.detail.brandingAllowed")
              : t("console.detail.brandingLocked")}
          </p>
          <ConsoleBranding
            tenantId={id}
            own={workspace.branding}
            inherited={{
              appName: inherited.appName,
              primaryColor: inherited.primaryColor,
              accentColor: inherited.accentColor,
            }}
            assets={{
              logoLight: brandAssetUrl(workspace.branding.logoLightPath),
              logoDark: brandAssetUrl(workspace.branding.logoDarkPath),
              favicon: brandAssetUrl(workspace.branding.faviconPath),
            }}
            actions={{
              save: updateClientBrandingAction,
              upload: uploadClientAssetAction,
              remove: removeClientAssetAction,
            }}
          />
        </section>
      ) : null}
    </ConsoleShell>
  );
}
