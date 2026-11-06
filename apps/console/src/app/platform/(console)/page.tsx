import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Skeleton } from "@crm/ui/components/skeleton";
import { listAgencies, listAllWorkspaces } from "@crm/core/services/admin";
import { t } from "@crm/shared/i18n";
import { ConsoleShell, NoAccess } from "@/components/console-shell";
import { CreateAgencyForm, CreateWorkspaceForm } from "@/components/create-forms";
import { AgenciesTable, WorkspacesTable } from "@/components/tables";
import {
  createAgencyAction,
  createWorkspaceAction,
  setAgencyStatusAction,
  setWorkspaceStatusAction,
} from "@/features/platform/actions";
import { getPlatformAccess } from "@/server/access";

export const metadata: Metadata = {
  title: t("console.platform.title"),
  robots: { index: false, follow: false },
};

export default function PlatformHome() {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96" aria-label={t("common.loading")} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const access = await getPlatformAccess();
  if (access.status === "unauthenticated") redirect("/login");
  if (access.status !== "ok") return <NoAccess />;

  const [agencies, workspaces] = await Promise.all([
    listAgencies(access.ctx),
    listAllWorkspaces(access.ctx),
  ]);
  const agencyNames = Object.fromEntries(agencies.map((a) => [a.id, a.name]));
  const canManage = access.ctx.role === "superadmin";

  return (
    <ConsoleShell title={t("console.platform.title")}>
      <section aria-labelledby="agencies-heading" className="flex flex-col gap-4">
        <h1 id="agencies-heading" className="text-2xl font-semibold">
          {t("console.agencies")}
        </h1>
        <AgenciesTable agencies={agencies} setStatus={setAgencyStatusAction} />
        {canManage ? <CreateAgencyForm action={createAgencyAction} /> : null}
      </section>
      <section aria-labelledby="workspaces-heading" className="flex flex-col gap-4">
        <h2 id="workspaces-heading" className="text-2xl font-semibold">
          {t("console.workspaces")}
        </h2>
        <WorkspacesTable
          workspaces={workspaces}
          agencyNames={agencyNames}
          setStatus={setWorkspaceStatusAction}
        />
        {canManage && agencies.length > 0 ? (
          <CreateWorkspaceForm
            action={createWorkspaceAction}
            agencies={agencies
              .filter((a) => a.status === "active")
              .map((a) => ({ id: a.id, name: a.name }))}
          />
        ) : null}
      </section>
    </ConsoleShell>
  );
}
