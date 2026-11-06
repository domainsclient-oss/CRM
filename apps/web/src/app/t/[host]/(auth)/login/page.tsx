import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Skeleton } from "@crm/ui/components/skeleton";
import { t } from "@crm/shared/i18n";
import { getPublicWorkspace, getWorkspaceAccess } from "@/server/workspace";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: t("auth.signIn.submit"),
  robots: { index: false, follow: false },
};

// Runtime data (host, cookies) stays inside Suspense; the static shell holds no tenant data.
export default function LoginPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" aria-label={t("common.loading")} />}>
      <LoginContent />
    </Suspense>
  );
}

async function LoginContent() {
  const workspace = await getPublicWorkspace();
  if (!workspace) notFound(); // unknown hosts reveal nothing (FR-TEN-004)
  const access = await getWorkspaceAccess();
  if (access.status === "ok") redirect("/");
  return <LoginForm workspaceName={workspace.name} />;
}
