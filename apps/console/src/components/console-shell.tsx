import type { ReactNode } from "react";
import Link from "next/link";
import { t } from "@crm/shared/i18n";
import { SignOutButton } from "./sign-out-button";

/** Shared page frame for both consoles. */
export function ConsoleShell({
  title,
  nav,
  children,
}: {
  title: string;
  nav?: Array<[href: string, label: string]>;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-semibold">{title}</span>
          {nav ? (
            <nav aria-label={t("console.nav")} className="flex gap-3 text-sm">
              {nav.map(([href, label]) => (
                <Link key={href} href={href} className="underline-offset-4 hover:underline">
                  {label}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
        <SignOutButton />
      </header>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-6">
        {children}
      </div>
    </div>
  );
}

export function NoAccess() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">{t("console.noAccess.title")}</h1>
      <p className="text-muted-foreground">{t("console.noAccess.body")}</p>
      <SignOutButton />
    </div>
  );
}

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        {children}
      </div>
    </div>
  );
}

export const agencyNav = (): Array<[string, string]> => [
  ["/", t("console.nav.workspaces")],
  ["/report", t("console.report")],
  ["/billing", t("console.nav.billing")],
  ["/settings", t("console.nav.settings")],
];
