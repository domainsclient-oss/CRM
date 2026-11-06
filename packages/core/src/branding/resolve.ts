import "server-only";
import { deriveTheme, type DerivedTheme } from "@crm/shared/branding/theme";
import { t } from "@crm/shared/i18n";
import {
  loadAgencyDoc,
  loadTenantDoc,
  resolveWorkspaceByHost,
  type TenantContext,
} from "../contexts/tenant-context";
import { resolveEffectiveConfig } from "../config/entitlements";
import type { AgencyDoc, TenantDoc } from "../model";

// Branding inheritance (FR-AGY-004, FR-BRAND-001): platform default → agency branding →
// workspace overrides (only when the agency allows workspace branding). Resolved at read time
// from the cached config docs, so changes reach every member within the cache TTL (≤ 60 s).

export interface StoredBranding {
  appName?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  logoLightPath?: string | null;
  logoDarkPath?: string | null;
  faviconPath?: string | null;
}

export const BRANDING_FIELDS = [
  "appName",
  "primaryColor",
  "accentColor",
  "logoLightPath",
  "logoDarkPath",
  "faviconPath",
] as const satisfies ReadonlyArray<keyof StoredBranding>;

export const PLATFORM_BRANDING = {
  appName: t("common.appName"),
  primaryColor: "#171717",
  accentColor: "#F59E0B",
  logoLightPath: null,
  logoDarkPath: null,
  faviconPath: null,
} satisfies Required<StoredBranding>;

export interface ResolvedBranding {
  appName: string;
  primaryColor: string;
  accentColor: string;
  logoLightPath: string | null;
  logoDarkPath: string | null;
  faviconPath: string | null;
  theme: DerivedTheme;
  /** Which level each value came from (for "inherited from agency" hints). */
  source: Record<(typeof BRANDING_FIELDS)[number], "platform" | "agency" | "workspace">;
}

function defined(b: unknown): StoredBranding {
  const out: StoredBranding = {};
  if (!b || typeof b !== "object") return out;
  for (const key of BRANDING_FIELDS) {
    const v = (b as Record<string, unknown>)[key];
    if (typeof v === "string" && v) out[key] = v;
  }
  return out;
}

export function resolveBranding(
  agency: Pick<AgencyDoc, "branding" | "entitlements"> | null,
  tenant: Pick<TenantDoc, "branding"> | null,
): ResolvedBranding {
  const agencyB = defined(agency?.branding);
  const tenantB = agency?.entitlements?.allowWorkspaceBranding ? defined(tenant?.branding) : {};
  const source = {} as ResolvedBranding["source"];
  const pick = <K extends (typeof BRANDING_FIELDS)[number]>(key: K) => {
    if (tenantB[key]) return ((source[key] = "workspace"), tenantB[key]!);
    if (agencyB[key]) return ((source[key] = "agency"), agencyB[key]!);
    source[key] = "platform";
    return PLATFORM_BRANDING[key];
  };
  const resolved = {
    appName: pick("appName"),
    primaryColor: pick("primaryColor"),
    accentColor: pick("accentColor"),
    logoLightPath: pick("logoLightPath"),
    logoDarkPath: pick("logoDarkPath"),
    faviconPath: pick("faviconPath"),
  };
  const derived = deriveTheme(resolved.primaryColor, resolved.accentColor);
  // Stored colours were validated on save; fall back defensively for legacy data.
  const theme = derived.ok
    ? derived.theme
    : (
        deriveTheme(PLATFORM_BRANDING.primaryColor, PLATFORM_BRANDING.accentColor) as {
          ok: true;
          theme: DerivedTheme;
        }
      ).theme;
  return { ...resolved, theme, source };
}

export async function getWorkspaceBranding(
  ctx: Pick<TenantContext, "tenant" | "agencyId">,
): Promise<ResolvedBranding> {
  const agency = await loadAgencyDoc(ctx.agencyId);
  return resolveBranding(agency, ctx.tenant);
}

export async function getBrandingForTenant(tenantId: string): Promise<ResolvedBranding | null> {
  const tenant = await loadTenantDoc(tenantId);
  if (!tenant) return null;
  return resolveBranding(await loadAgencyDoc(tenant.agencyId), tenant);
}

/**
 * Public branding for login/invite/reset pages on a workspace host (FR-PUB-003): name, logos,
 * colours only. Null for unknown hosts or inactive workspaces.
 */
export async function getPublicBranding(
  host: string,
): Promise<(ResolvedBranding & { workspaceName: string; showPoweredBy: boolean }) | null> {
  const ref = await resolveWorkspaceByHost(host);
  if (!ref) return null;
  const [tenant, agency] = await Promise.all([
    loadTenantDoc(ref.tenantId),
    loadAgencyDoc(ref.agencyId),
  ]);
  const usable = tenant && (tenant.status === "active" || tenant.status === "pending_deletion");
  if (!tenant || !usable || !agency || agency.status !== "active") return null;
  return {
    ...resolveBranding(agency, tenant),
    workspaceName: tenant.name,
    showPoweredBy: resolveEffectiveConfig(tenant, agency).showPoweredBy,
  };
}

/** Same-origin URL for a stored brand asset (served by /api/brand on web and console). */
export function brandAssetUrl(path: string | null): string | null {
  return path ? `/api/brand/${path}` : null;
}
