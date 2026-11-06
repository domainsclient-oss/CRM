import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@crm/ui/components/skeleton";
import { loadAgencyDoc } from "@crm/core/contexts/tenant";
import { brandAssetUrl, resolveBranding } from "@crm/core/branding/resolve";
import { t } from "@crm/shared/i18n";
import { can, requireCtx } from "@/features/records/data";
import { WorkspaceBranding } from "@/features/branding/workspace-branding";

export const metadata: Metadata = {
  title: t("branding.title"),
  robots: { index: false, follow: false },
};

export default function BrandingPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" aria-label={t("common.loading")} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const ctx = await requireCtx();
  if (!ctx) return null;
  const agency = await loadAgencyDoc(ctx.agencyId);
  const allowed = Boolean(agency?.entitlements?.allowWorkspaceBranding);
  const own = (ctx.tenant.branding ?? {}) as Record<string, string | undefined>;
  const inherited = resolveBranding(agency, null);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("branding.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("branding.body")}</p>
      {!allowed ? (
        <p role="status" className="rounded-lg border p-3 text-sm">
          {t("branding.disabled")}
        </p>
      ) : !can(ctx, "branding.manage") ? (
        <p className="text-sm text-muted-foreground">{t("branding.readOnly")}</p>
      ) : null}
      <WorkspaceBranding
        own={{
          appName: own.appName ?? null,
          primaryColor: own.primaryColor ?? null,
          accentColor: own.accentColor ?? null,
        }}
        inherited={{
          appName: inherited.appName,
          primaryColor: inherited.primaryColor,
          accentColor: inherited.accentColor,
        }}
        assets={{
          logoLight: brandAssetUrl(own.logoLightPath ?? null),
          logoDark: brandAssetUrl(own.logoDarkPath ?? null),
          favicon: brandAssetUrl(own.faviconPath ?? null),
        }}
        readOnly={!allowed || !can(ctx, "branding.manage")}
      />
    </div>
  );
}
