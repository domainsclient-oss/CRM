import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@crm/ui/components/skeleton";
import { getPipeline, openStages } from "@crm/core/records/deals";
import { t } from "@crm/shared/i18n";
import { can, requireCtx } from "@/features/records/data";
import { PipelineEditor } from "@/features/settings/settings-forms";

export const metadata: Metadata = {
  title: t("settings.pipeline"),
  robots: { index: false, follow: false },
};

export default function PipelineSettingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" aria-label={t("common.loading")} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const ctx = await requireCtx();
  if (!ctx) return null;
  const pipeline = await getPipeline(ctx);
  const stages = openStages(pipeline).map((s) => ({
    id: s.id,
    name: s.name,
    probability: s.probability,
  }));
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("settings.pipeline")}</h1>
      <PipelineEditor
        key={stages.map((s) => `${s.id}:${s.name}:${s.probability}`).join("|")}
        stages={stages}
        readOnly={!can(ctx, "pipeline.manage")}
      />
    </div>
  );
}
