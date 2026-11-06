import Image from "next/image";
import { brandAssetUrl } from "@crm/core/branding/resolve";
import { t } from "@crm/shared/i18n";

// Workspace logo (light/dark variants) or the app name when no logo is set (FR-BRAND-001).
export function BrandMark({
  appName,
  logoLightPath,
  logoDarkPath,
  size = "md",
}: {
  appName: string;
  logoLightPath: string | null;
  logoDarkPath: string | null;
  size?: "md" | "lg";
}) {
  const light = brandAssetUrl(logoLightPath);
  const dark = brandAssetUrl(logoDarkPath) ?? light;
  const height = size === "lg" ? "h-10" : "h-8";
  if (!light) return <span className="font-semibold">{appName}</span>;
  return (
    <>
      <Image
        src={light}
        alt={appName}
        width={200}
        height={40}
        unoptimized
        className={`${height} w-auto max-w-48 object-contain dark:hidden`}
      />
      <Image
        src={dark!}
        alt={appName}
        width={200}
        height={40}
        unoptimized
        className={`${height} hidden w-auto max-w-48 object-contain dark:block`}
      />
    </>
  );
}

export function PoweredBy() {
  return (
    <p className="py-3 text-center text-xs text-muted-foreground">{t("branding.poweredBy")}</p>
  );
}
