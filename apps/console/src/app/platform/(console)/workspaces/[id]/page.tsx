import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Skeleton } from "@crm/ui/components/skeleton";
import { PLAN_IDS } from "@crm/core/config/entitlements";
import { listDomains } from "@crm/core/domains/service";
import { AppError } from "@crm/core/errors";
import { getWorkspaceDetail } from "@crm/core/services/agency-admin";
import { platformAllows } from "@crm/shared/permissions";
import { t } from "@crm/shared/i18n";
import { PlanEditor } from "@/components/admin-forms";
import { ConsoleShell, NoAccess } from "@/components/console-shell";
import { DomainsManager } from "@/components/domains-manager";
import { WorkspaceOverview } from "@/components/workspace-overview";
import {
  platformAddDomainAction,
  platformCheckDomainAction,
  platformRemoveDomainAction,
  platformSetCanonicalDomainAction,
  setWorkspacePlanAction,
} from "@/features/platform/actions";
import { getPlatformAccess } from "@/server/access";

export const metadata: Metadata = {
  title: t("console.platform.title"),
  robots: { index: false, follow: false },
};

export default async function PlatformWorkspacePage(props: PageProps<"/platform/workspaces/[id]">) {
  const { id } = await props.params;
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96" aria-label={t("common.loading")} />}>
      <Content id={id} />
    </Suspense>
  );
}

async function Content({ id }: { id: string }) {
  const access = await getPlatformAccess();
  if (access.status === "unauthenticated") redirect("/login");
  if (access.status !== "ok") return <NoAccess />;
  const { ctx } = access;
  const actor = { kind: "platform" as const, ctx };
  const workspace = await getWorkspaceDetail(actor, id).catch((error: unknown) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const canManage = platformAllows(ctx.role, "platform.tenant.manage");
  const domains = canManage ? await listDomains(actor, id) : [];

  return (
    <ConsoleShell title={t("console.platform.title")}>
      <Link href="/" className="text-sm underline-offset-4 hover:underline">
        ← {t("console.back")}
      </Link>
      <h1 className="text-2xl font-semibold">{workspace.name}</h1>
      <WorkspaceOverview w={workspace} />
      {platformAllows(ctx.role, "platform.plan.manage") ? (
        <PlanEditor
          tenantId={id}
          planId={workspace.planId}
          plans={PLAN_IDS}
          overrides={workspace.overrides}
          flags={workspace.flags}
          action={setWorkspacePlanAction}
        />
      ) : null}
      {canManage ? (
        <DomainsManager
          tenantId={id}
          domains={domains}
          actions={{
            add: platformAddDomainAction,
            check: platformCheckDomainAction,
            setCanonical: platformSetCanonicalDomainAction,
            remove: platformRemoveDomainAction,
          }}
        />
      ) : null}
    </ConsoleShell>
  );
}
