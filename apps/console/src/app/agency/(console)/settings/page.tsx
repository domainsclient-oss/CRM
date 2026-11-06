import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Skeleton } from "@crm/ui/components/skeleton";
import { brandAssetUrl, resolveBranding } from "@crm/core/branding/resolve";
import { listStaff } from "@crm/core/services/agency-admin";
import { agencyAllows } from "@crm/shared/permissions";
import { t } from "@crm/shared/i18n";
import { BaseDomainForm, ConsoleBranding, StaffManager } from "@/components/admin-forms";
import { ConsoleShell, NoAccess, agencyNav } from "@/components/console-shell";
import {
  inviteStaffAction,
  removeAgencyAssetAction,
  setBaseDomainAction,
  updateAgencyBrandingAction,
  uploadAgencyAssetAction,
} from "@/features/agency/actions";
import { getAgencyAccess } from "@/server/access";

export const metadata: Metadata = {
  title: t("console.nav.settings"),
  robots: { index: false, follow: false },
};

export default function AgencySettingsPage() {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96" aria-label={t("common.loading")} />}>
      <Content />
    </Suspense>
  );
}

// Agency defaults (FR-AGY-004), base domain (FR-TEN-009), and staff (FR-AGY-002).
async function Content() {
  const access = await getAgencyAccess();
  if (access.status === "unauthenticated") redirect("/login");
  if (access.status !== "ok") return <NoAccess />;
  const { ctx } = access;
  const staff = await listStaff(ctx);
  const own = (ctx.agency.branding ?? {}) as Record<string, string | undefined>;
  const platform = resolveBranding(null, null);

  return (
    <ConsoleShell title={`${t("console.agency.title")} · ${ctx.agency.name}`} nav={agencyNav()}>
      <h1 className="text-2xl font-semibold">{t("console.nav.settings")}</h1>
      {agencyAllows(ctx.role, "agency.branding.manage") ? (
        <section aria-labelledby="agency-branding-heading" className="flex flex-col gap-3">
          <h2 id="agency-branding-heading" className="text-lg font-medium">
            {t("console.agencyBranding")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("console.agencyBrandingBody")}</p>
          <ConsoleBranding
            own={{
              appName: own.appName ?? null,
              primaryColor: own.primaryColor ?? null,
              accentColor: own.accentColor ?? null,
            }}
            inherited={{
              appName: platform.appName,
              primaryColor: platform.primaryColor,
              accentColor: platform.accentColor,
            }}
            assets={{
              logoLight: brandAssetUrl(own.logoLightPath ?? null),
              logoDark: brandAssetUrl(own.logoDarkPath ?? null),
              favicon: brandAssetUrl(own.faviconPath ?? null),
            }}
            actions={{
              save: updateAgencyBrandingAction,
              upload: uploadAgencyAssetAction,
              remove: removeAgencyAssetAction,
            }}
          />
        </section>
      ) : null}
      {agencyAllows(ctx.role, "agency.workspace.domain") ? (
        <BaseDomainForm value={ctx.agency.baseDomain ?? null} action={setBaseDomainAction} />
      ) : null}
      <StaffManager
        staff={staff.staff}
        pending={staff.pending}
        canInvite={agencyAllows(ctx.role, "agency.staff.manage")}
        action={inviteStaffAction}
      />
    </ConsoleShell>
  );
}
