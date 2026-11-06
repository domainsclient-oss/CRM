import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Skeleton } from "@crm/ui/components/skeleton";
import { listEmailOverrides } from "@crm/core/branding/emails";
import { t } from "@crm/shared/i18n";
import { can, requireCtx } from "@/features/records/data";
import { EmailTemplates } from "@/features/branding/email-templates";

export const metadata: Metadata = {
  title: t("emails.title"),
  robots: { index: false, follow: false },
};

export default function EmailsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" aria-label={t("common.loading")} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const ctx = await requireCtx();
  if (!ctx) return null;
  if (!can(ctx, "branding.manage")) notFound();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("emails.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("emails.body")}</p>
      <EmailTemplates overrides={await listEmailOverrides(ctx)} />
    </div>
  );
}
