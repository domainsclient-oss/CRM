import type { TenantContext } from "@crm/core/contexts/tenant";
import { t } from "@crm/shared/i18n";
import { CancelDeletionButton } from "./danger-zone";
import { SignOutButton } from "@/app/t/[host]/(app)/sign-out-button";

// Shown to the Owner while the workspace is scheduled for deletion (FR-TEN-006 AC2).
export function PendingDeletion({ ctx }: { ctx: TenantContext }) {
  const scheduled = (ctx.tenant as unknown as { deletionScheduledFor?: { toDate(): Date } })
    .deletionScheduledFor;
  const date = scheduled ? scheduled.toDate().toISOString().slice(0, 10) : "—";
  return (
    <main id="main" className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">{t("tenant.pendingTitle")}</h1>
      <p className="text-muted-foreground">{t("tenant.pendingBody", { date })}</p>
      <div className="flex justify-center gap-2">
        <CancelDeletionButton />
        <SignOutButton />
      </div>
    </main>
  );
}
