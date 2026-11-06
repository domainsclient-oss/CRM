import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Skeleton } from "@crm/ui/components/skeleton";
import { t } from "@crm/shared/i18n";
import { AuthCard } from "@/components/console-shell";
import { SignInForm } from "@/components/sign-in-form";
import { getAgencyAccess } from "@/server/access";

export const metadata: Metadata = {
  title: t("console.agency.title"),
  robots: { index: false, follow: false },
};

export default function AgencyLogin({ searchParams }: PageProps<"/agency/login">) {
  return (
    <AuthCard>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function Content({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if ((await getAgencyAccess()).status === "ok") redirect("/");
  const revoked = (await searchParams).revoked === "1";
  return (
    <SignInForm
      title={t("console.agency.title")}
      body={t("console.signIn.agencyBody")}
      allowPassword
      notice={revoked ? t("console.signIn.revoked") : undefined}
    />
  );
}
