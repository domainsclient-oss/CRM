import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Skeleton } from "@crm/ui/components/skeleton";
import { getEffectiveConfig } from "@crm/core/config/entitlements";
import { usageBanner } from "@crm/core/config/usage";
import { unreadCount } from "@crm/core/notifications";
import { myDueTaskCount } from "@crm/core/records/tasks";
import { getProfile } from "@crm/core/records/workspace-data";
import { listUserWorkspaces } from "@crm/core/services/workspaces";
import { workspaceScope } from "@crm/shared/permissions";
import { t } from "@crm/shared/i18n";
import { BrandMark, PoweredBy } from "@/features/branding/brand-mark";
import { getHostBranding, getWorkspaceAccess } from "@/server/workspace";
import { CommandPalette } from "@/features/data/command-palette";
import { NotificationBell } from "@/features/data/notification-bell";
import { PendingDeletion } from "@/features/data/pending-deletion";
import { MobileNav, NavList, RouteFocus, type NavLink } from "@/features/shell/app-nav";
import {
  OfflineBanner,
  SessionExpiredDialog,
  ThemeApplier,
} from "@/features/shell/status-watchers";
import { SignOutButton } from "./sign-out-button";
import { WorkspaceSwitcher } from "./workspace-switcher";

// Authenticated workspace shell. Access is resolved server-side on every request
// (session → host workspace → active membership); nothing here is cached across users.
export default function AppLayout({ children }: LayoutProps<"/t/[host]">) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

function ShellFallback() {
  return (
    <main
      id="main"
      className="flex flex-col gap-4 p-6"
      aria-busy="true"
      aria-label={t("common.loading")}
    >
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-40 w-full" />
    </main>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  const access = await getWorkspaceAccess();
  if (access.status !== "ok") {
    if (access.status === "unauthenticated") redirect("/login");
    if (access.status === "not_found") notFound();
    const key = access.status === "forbidden" ? "app.noAccess" : "app.suspended";
    return (
      <main id="main" className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">{t(`${key}.title`)}</h1>
        <p className="text-muted-foreground">{t(`${key}.body`)}</p>
        <div className="flex justify-center">
          <SignOutButton />
        </div>
      </main>
    );
  }

  const { ctx } = access;
  // Scheduled for deletion: the Owner sees only the cancel screen (FR-TEN-006 AC2).
  if (ctx.tenant.status === "pending_deletion") return <PendingDeletion ctx={ctx} />;
  const [workspaces, due, branding, config, usage, unread, profile] = await Promise.all([
    listUserWorkspaces(ctx.uid),
    myDueTaskCount(ctx),
    getHostBranding(),
    getEffectiveConfig(ctx),
    usageBanner(ctx),
    unreadCount(ctx),
    getProfile(ctx),
  ]);
  const links: NavLink[] = [
    ["/", t("nav.home")],
    ["/contacts", t("nav.contacts")],
    ["/contacts?filter=stage&value=customer", t("nav.customers")],
    ["/companies", t("nav.companies")],
    ["/leads", t("nav.leads")],
    ["/deals", t("nav.deals")],
    ["/pipeline", t("nav.pipeline")],
    ...(workspaceScope(ctx.role, "report.read")
      ? [["/reports", t("nav.reports")] as [string, string]]
      : []),
    ["/my-tasks", due > 0 ? t("nav.myTasksDue", { count: due }) : t("nav.myTasks")],
    ...(workspaceScope(ctx.role, "record.restore")
      ? [["/trash", t("nav.trash")] as [string, string]]
      : []),
    ["/settings/profile", t("nav.settings")],
  ];
  const banner = config.readOnly ? (
    <p
      role="status"
      className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50"
    >
      {t("usage.readOnly")}
    </p>
  ) : usage ? (
    <p
      role="status"
      className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50"
    >
      {usage.level === "exceeded" ? t("usage.exceeded") : t("usage.warning")}{" "}
      <Link href="/settings/usage" className="underline">
        {t("nav.usage")}
      </Link>
    </p>
  ) : null;

  // 06 §5.1: sidebar ≥ lg, drawer below; landmarks header / nav / main.
  return (
    <div className="flex min-h-dvh flex-col">
      <ThemeApplier theme={profile.theme} />
      <RouteFocus />
      <SessionExpiredDialog />
      <header className="sticky top-0 z-40 flex items-center justify-between gap-2 border-b bg-background px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <MobileNav links={links} />
          <Link href="/" className="flex min-w-0 items-center gap-2">
            {branding ? (
              <BrandMark
                appName={branding.appName}
                logoLightPath={branding.logoLightPath}
                logoDarkPath={branding.logoDarkPath}
              />
            ) : (
              <span className="truncate font-semibold">{ctx.tenant.name}</span>
            )}
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          <CommandPalette />
          <NotificationBell initialUnread={unread} />
          <div className="hidden md:block">
            <WorkspaceSwitcher current={ctx.tenantId} workspaces={workspaces} />
          </div>
          <div className="hidden sm:block">
            <SignOutButton />
          </div>
        </div>
      </header>
      <OfflineBanner />
      {banner}
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-e p-3 lg:block">
          <nav aria-label={t("nav.main")} className="sticky top-16">
            <NavList links={links} />
            <div className="mt-4 flex flex-col gap-2 border-t pt-4 md:hidden">
              <WorkspaceSwitcher current={ctx.tenantId} workspaces={workspaces} />
            </div>
          </nav>
        </aside>
        <main id="main" className="min-w-0 flex-1 px-4 py-6 lg:px-6" tabIndex={-1}>
          {children}
        </main>
      </div>
      <footer className="border-t">
        <div className="flex items-center justify-between gap-2 px-4 py-2 sm:hidden">
          <WorkspaceSwitcher current={ctx.tenantId} workspaces={workspaces} />
          <SignOutButton />
        </div>
        {config.showPoweredBy ? <PoweredBy /> : null}
      </footer>
    </div>
  );
}
