import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@crm/ui/components/skeleton";
import { listTeam } from "@crm/core/services/members";
import { workspaceScope } from "@crm/shared/permissions";
import { t } from "@crm/shared/i18n";
import { getWorkspaceAccess } from "@/server/workspace";
import { TeamManager } from "./team-manager";

export const metadata: Metadata = {
  title: t("team.title"),
  robots: { index: false, follow: false },
};

export default function MembersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" aria-label={t("common.loading")} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const access = await getWorkspaceAccess();
  if (access.status !== "ok") return null; // the layout renders the access state
  const { ctx } = access;
  const team = await listTeam(ctx);
  const can = (p: Parameters<typeof workspaceScope>[1]) => workspaceScope(ctx.role, p) !== null;

  return (
    <TeamManager
      me={{ uid: ctx.uid, role: ctx.role }}
      members={team.members}
      invitations={team.invitations}
      permissions={{
        invite: can("member.invite"),
        update: can("member.update"),
        remove: can("member.remove"),
        forceSignOut: can("member.forceSignOut"),
        transfer: can("tenant.transferOwnership"),
      }}
    />
  );
}
