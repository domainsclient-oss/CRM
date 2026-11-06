import { logger } from "@crm/core/logger";
import { POLICIES, enforceRateLimit } from "@crm/core/rate-limit";

// Web-vitals beacons from public pages (07 §7 RUM). Accepts only a tiny, fixed shape; logs it for
// dashboards. No cookies are read and nothing is stored per user. PROTECTED FILE (08 §8).
const NAMES = new Set(["CLS", "FCP", "INP", "LCP", "TTFB", "FID"]);

export async function POST(request: Request) {
  // Per-IP cap keeps the log volume (and cost) bounded; excess beacons are dropped silently.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown-ip";
  const allowed = await enforceRateLimit(POLICIES.vitalsByIp, ip).then(
    () => true,
    () => false,
  );
  if (!allowed)
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const text = (await request.text()).slice(0, 512);
  try {
    const m = JSON.parse(text) as {
      name?: unknown;
      value?: unknown;
      rating?: unknown;
      path?: unknown;
    };
    if (
      typeof m.name === "string" &&
      NAMES.has(m.name) &&
      typeof m.value === "number" &&
      Number.isFinite(m.value) &&
      typeof m.path === "string" &&
      /^\/[A-Za-z0-9/_-]{0,100}$/.test(m.path)
    ) {
      logger.info("web_vital", {
        metric: m.name,
        value: m.value,
        rating: typeof m.rating === "string" ? m.rating.slice(0, 20) : null,
        path: m.path,
      });
    }
  } catch {
    // ignore malformed beacons
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
