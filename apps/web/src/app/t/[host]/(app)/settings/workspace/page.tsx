import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@crm/ui/components/skeleton";
import { readTenantSettings } from "@crm/core/records/workspace-data";
import { t } from "@crm/shared/i18n";
import { can, requireCtx } from "@/features/records/data";
import { WorkspaceSettingsForm } from "@/features/settings/settings-forms";

export const metadata: Metadata = {
  title: t("settings.workspace"),
  robots: { index: false, follow: false },
};

export default function WorkspaceSettingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" aria-label={t("common.loading")} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const ctx = await requireCtx();
  if (!ctx) return null;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("settings.workspace")}</h1>
      <WorkspaceSettingsForm
        values={readTenantSettings(ctx)}
        timeZones={Intl.supportedValuesOf("timeZone")}
        readOnly={!can(ctx, "settings.manage")}
      />
    </div>
  );
}
