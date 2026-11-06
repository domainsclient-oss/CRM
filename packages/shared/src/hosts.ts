// Host classification (requirements/02 §3, 05 §5). Pure functions — safe in proxy and server.
// A "workspace" class only means *candidate*: the server must still find an active
// tenantDomains/{host} mapping before serving anything.

export type HostClass = "marketing" | "console" | "partners" | "workspace";

export interface HostConfig {
  marketingHost: string;
  consoleHost: string;
  partnersHost: string;
}

const HOST_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;

/** Lowercase, trim, drop a trailing dot; null when not a syntactically valid host[:port]. */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/\.(?=:\d+$|$)/, "");
  return HOST_PATTERN.test(host) ? host : null;
}

export function classifyHost(host: string, config: HostConfig): HostClass {
  if (host === normalizeHost(config.marketingHost)) return "marketing";
  if (host === normalizeHost(config.consoleHost)) return "console";
  if (host === normalizeHost(config.partnersHost)) return "partners";
  return "workspace";
}

/** Same-origin check for state-changing requests (requirements/04 §8 CSRF). */
export function isSameOrigin(origin: string | null | undefined, host: string): boolean {
  if (!origin) return false;
  try {
    return normalizeHost(new URL(origin).host) === host;
  } catch {
    return false;
  }
}
