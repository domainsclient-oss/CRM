import { NextResponse, type NextRequest } from "next/server";
import { classifyHost, normalizeHost } from "@crm/shared/hosts";
import {
  baseSecurityHeaders,
  buildCsp,
  generateNonce,
  type SurfaceClass,
} from "@crm/shared/security-headers";
import { robotsTxt } from "@crm/shared/seo";
import { canonicalRedirectHost, resolveWorkspaceByHost } from "@crm/core/contexts/tenant";

// Host routing + security headers (requirements/02 §3, 04 §10). Never an authorization
// boundary: every page, Server Action and Route Handler re-checks session + membership.
// Unknown workspace hosts get a real 404 here, before streaming starts (FR-TEN-004);
// the lookup uses the same 60 s host cache as the server contexts.
// PROTECTED FILE (requirements/08 §8).

const INTERNAL_PREFIX = "/t/";

function hostConfig() {
  return {
    marketingHost: process.env.APP_MARKETING_HOST ?? "localhost:3000",
    consoleHost: process.env.APP_CONSOLE_HOST ?? "console.localhost:3001",
    partnersHost: process.env.APP_PARTNERS_HOST ?? "partners.localhost:3001",
  };
}

function isSecure(request: NextRequest): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  return proto ? proto === "https" : request.nextUrl.protocol === "https:";
}

function csp(nonce?: string): string {
  return buildCsp({
    nonce,
    dev: process.env.NODE_ENV === "development",
    authEmulator: process.env.NEXT_PUBLIC_USE_AUTH_EMULATOR === "true",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    assetsOrigin: process.env.APP_ASSETS_BASE_URL,
  });
}

function withHeaders(
  response: NextResponse,
  surface: SurfaceClass,
  secure: boolean,
  policy?: string,
) {
  for (const [key, value] of Object.entries(baseSecurityHeaders(surface, secure))) {
    response.headers.set(key, value);
  }
  if (policy) response.headers.set("Content-Security-Policy", policy);
  return response;
}

function notFound(): NextResponse {
  return new NextResponse("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex" } });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // The internal rewrite target must never be reachable directly, on any host.
  if (pathname === "/t" || pathname.startsWith(INTERNAL_PREFIX)) return notFound();

  const host = normalizeHost(request.headers.get("host"));
  if (!host) return notFound();
  const secure = isSecure(request);

  const hostClass = classifyHost(host, hostConfig());
  if (hostClass === "marketing") {
    // Static marketing pages: nonce-less policy (no user content), cacheable.
    return withHeaders(NextResponse.next(), "marketing", secure, csp());
  }
  // Consoles are served by apps/console, never by this app.
  if (hostClass === "console" || hostClass === "partners") return notFound();

  // Candidate workspace host. Crawlers may fetch robots.txt (so they see the noindex header);
  // sitemaps and llms.txt exist only on the marketing host (07 §1).
  if (pathname === "/robots.txt") {
    const robots = new NextResponse(robotsTxt("workspace"), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
    return withHeaders(robots, "workspace", secure);
  }
  if (pathname === "/sitemap.xml" || pathname === "/llms.txt") return notFound();
  // API routes read the host themselves.
  if (pathname.startsWith("/api/")) return withHeaders(NextResponse.next(), "workspace", secure);
  if (!(await resolveWorkspaceByHost(host))) return notFound();
  // Platform fallback host → canonical custom/agency host (301), path and query preserved.
  const canonical = await canonicalRedirectHost(host);
  if (canonical) {
    const target = new URL(
      `${secure ? "https" : "http"}://${canonical}${pathname}${request.nextUrl.search}`,
    );
    return withHeaders(NextResponse.redirect(target, 301), "workspace", secure);
  }

  // Pages: per-request nonce. Next.js reads the CSP request header and nonces its scripts.
  const nonce = generateNonce();
  const policy = csp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const target = new URL(
    `${INTERNAL_PREFIX}${encodeURIComponent(host)}${pathname}${request.nextUrl.search}`,
    request.url,
  );
  return withHeaders(
    NextResponse.rewrite(target, { request: { headers: requestHeaders } }),
    "workspace",
    secure,
    policy,
  );
}

export const config = {
  // Skip static assets and image optimization; everything else is routed.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
