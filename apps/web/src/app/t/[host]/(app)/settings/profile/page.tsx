import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@crm/ui/components/skeleton";
import { getNotificationPrefs } from "@crm/core/notifications";
import { getProfile } from "@crm/core/records/workspace-data";
import { t } from "@crm/shared/i18n";
import { requireCtx } from "@/features/records/data";
import { DeleteAccount } from "@/features/data/danger-zone";
import { NotificationPrefsForm } from "@/features/data/notification-prefs";
import { ProfileForm } from "@/features/settings/settings-forms";

export const metadata: Metadata = {
  title: t("settings.profile"),
  robots: { index: false, follow: false },
};

export default function ProfilePage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" aria-label={t("common.loading")} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const ctx = await requireCtx();
  if (!ctx) return null;
  const [profile, prefs] = await Promise.all([getProfile(ctx), getNotificationPrefs(ctx)]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("settings.profile")}</h1>
      <ProfileForm values={profile} timeZones={Intl.supportedValuesOf("timeZone")} />
      <NotificationPrefsForm initial={prefs} />
      <DeleteAccount />
    </div>
  );
}
