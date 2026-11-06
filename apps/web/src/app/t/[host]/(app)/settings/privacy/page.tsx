import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Skeleton } from "@crm/ui/components/skeleton";
import { recordOptions } from "@crm/core/records/workspace-data";
import { t } from "@crm/shared/i18n";
import { can, requireCtx } from "@/features/records/data";
import { DeleteWorkspace } from "@/features/data/danger-zone";
import { PrivacyTools } from "@/features/data/privacy-tools";

export const metadata: Metadata = {
  title: t("privacy.title"),
  robots: { index: false, follow: false },
};

export default function PrivacyPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" aria-label={t("common.loading")} />}>
      <Content />
    </Suspense>
  );
}

// Data subject requests (Admin+) and workspace deletion (Owner).
async function Content() {
  const ctx = await requireCtx();
  if (!ctx) return null;
  if (!can(ctx, "privacy.manage")) notFound();
  const contacts = await recordOptions(ctx, "contacts");
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3" aria-labelledby="dsar-heading">
        <h1 id="dsar-heading" className="text-2xl font-semibold">
          {t("privacy.dsar")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("privacy.dsarBody")}</p>
        <PrivacyTools contacts={contacts} />
      </section>
      {can(ctx, "tenant.delete") ? (
        <section
          className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-4"
          aria-labelledby="delete-heading"
        >
          <h2 id="delete-heading" className="text-lg font-medium">
            {t("tenant.delete")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("tenant.deleteBody")}</p>
          <div>
            <DeleteWorkspace slug={ctx.tenant.slug} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
