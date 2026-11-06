import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Skeleton } from "@crm/ui/components/skeleton";
import { listAgencyWorkspaces } from "@crm/core/services/admin";
import { t } from "@crm/shared/i18n";
import { ConsoleShell, NoAccess, agencyNav } from "@/components/console-shell";
import { CreateWorkspaceForm } from "@/components/create-forms";
import { WorkspacesTable } from "@/components/tables";
import { createWorkspaceAction, setWorkspaceStatusAction } from "@/features/agency/actions";
import { getAgencyAccess } from "@/server/access";

export const metadata: Metadata = {
  title: t("console.agency.title"),
  robots: { index: false, follow: false },
};

export default function AgencyHome() {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96" aria-label={t("common.loading")} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const access = await getAgencyAccess();
  if (access.status === "unauthenticated") redirect("/login");
  if (access.status !== "ok") return <NoAccess />;
  const { ctx } = access;
  const workspaces = await listAgencyWorkspaces(ctx);

  return (
    <ConsoleShell title={`${t("console.agency.title")} · ${ctx.agency.name}`} nav={agencyNav()}>
      <section aria-labelledby="workspaces-heading" className="flex flex-col gap-4">
        <h1 id="workspaces-heading" className="text-2xl font-semibold">
          {t("console.workspaces")}
        </h1>
        <WorkspacesTable workspaces={workspaces} setStatus={setWorkspaceStatusAction} />
        {ctx.agency.entitlements.canProvisionWorkspaces ? (
          <CreateWorkspaceForm action={createWorkspaceAction} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("console.cannotProvision")}</p>
        )}
      </section>
    </ConsoleShell>
  );
}
