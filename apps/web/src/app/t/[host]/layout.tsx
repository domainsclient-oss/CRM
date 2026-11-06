import type { Metadata } from "next";
import { connection } from "next/server";
import { brandAssetUrl } from "@crm/core/branding/resolve";
import { themeCss } from "@crm/shared/branding/theme";
import { Toaster } from "@crm/ui/components/sonner";
import { getHostBranding, getNonce } from "@/server/workspace";

// Always rendered per request so every script carries this request's CSP nonce
// (requirements/04 §10). Applies the workspace's resolved branding (FR-BRAND-001/002): title,
// favicon, and theme colours as CSS variables (validated hex only) in a nonced <style>.

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getHostBranding();
  const favicon = brandAssetUrl(branding?.faviconPath ?? null);
  return {
    ...(branding
      ? { title: { template: `%s · ${branding.appName}`, default: branding.appName } }
      : {}),
    ...(favicon ? { icons: { icon: favicon } } : {}),
    robots: { index: false, follow: false },
  };
}

export default async function WorkspaceHostLayout({ children }: LayoutProps<"/t/[host]">) {
  await connection();
  const [branding, nonce] = await Promise.all([getHostBranding(), getNonce()]);
  return (
    <>
      {branding ? <style nonce={nonce}>{themeCss(branding.theme)}</style> : null}
      {children}
      <Toaster />
    </>
  );
}
