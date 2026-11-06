import Link from "next/link";
import { t } from "@crm/shared/i18n";

// Settings sub-navigation. Each page re-checks permissions server-side.
export default function SettingsLayout({ children }: LayoutProps<"/t/[host]/settings">) {
  const links = [
    ["/settings/profile", t("settings.profile")],
    ["/settings/workspace", t("settings.workspace")],
    ["/settings/pipeline", t("settings.pipeline")],
    ["/settings/branding", t("nav.branding")],
    ["/settings/emails", t("nav.emails")],
    ["/settings/usage", t("nav.usage")],
    ["/settings/billing", t("nav.billing")],
    ["/settings/import", t("nav.import")],
    ["/settings/audit", t("nav.audit")],
    ["/settings/privacy", t("nav.privacy")],
    ["/settings/members", t("nav.team")],
  ] as const;
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t("settings.sections")} className="flex flex-wrap gap-2 border-b pb-3">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className="rounded-md px-2 py-1 text-sm hover:bg-muted">
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
