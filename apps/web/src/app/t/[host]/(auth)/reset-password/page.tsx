import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Skeleton } from "@crm/ui/components/skeleton";
import { t } from "@crm/shared/i18n";
import { getPublicWorkspace } from "@/server/workspace";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = {
  title: t("auth.reset.title"),
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Skeleton className="h-48 w-full" aria-label={t("common.loading")} />}>
      <ResetContent />
    </Suspense>
  );
}

async function ResetContent() {
  if (!(await getPublicWorkspace())) notFound();
  return <ResetForm />;
}
