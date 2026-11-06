import { BrandMark, PoweredBy } from "@/features/branding/brand-mark";
import { getHostBranding } from "@/server/workspace";

// Centered card layout for sign-in, reset and invitation pages (requirements/06 §5.2), branded
// with the workspace's public branding only (FR-PUB-003): logo/name and colours — nothing else.
export default async function AuthLayout({ children }: LayoutProps<"/t/[host]">) {
  const branding = await getHostBranding();
  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      {branding ? (
        <div className="flex items-center gap-2" data-testid="brand">
          <BrandMark
            appName={branding.appName}
            logoLightPath={branding.logoLightPath}
            logoDarkPath={branding.logoDarkPath}
            size="lg"
          />
        </div>
      ) : null}
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        {children}
      </div>
      {branding?.showPoweredBy ? <PoweredBy /> : null}
    </main>
  );
}
