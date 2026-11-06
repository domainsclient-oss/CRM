import { NextResponse, type NextRequest } from "next/server";
import { classifyHost, normalizeHost } from "@crm/shared/hosts";
import { baseSecurityHeaders, buildCsp, generateNonce } from "@crm/shared/security-headers";
import { robotsTxt } from "@crm/shared/seo";

// Console routing + security headers (ADR-018, requirements/04 §10).
// console.* → /platform/*, partners.* → /agency/*. Never an authorization boundary —
// pages and actions re-check sessions and roles. PROTECTED FILE (requirements/08 §8).

const INTERNAL = { console: "/platform", partners: "/agency" } as const;

function hostConfig() {
  return {
    marketingHost: process.env.APP_MARKETING_HOST ?? "localhost:3000",
    consoleHost: process.env.APP_CONSOLE_HOST ?? "console.localhost:3001",
    partnersHost: process.env.APP_PARTNERS_HOST ?? "partners.localhost:3001",
  };
}

function notFound(): NextResponse {
  return new NextResponse("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex" } });
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Internal segments are never reachable directly.
  if (/^\/(platform|agency)(\/|$)/.test(pathname)) return notFound();

  const host = normalizeHost(request.headers.get("host"));
  if (!host) return notFound();
  const hostClass = classifyHost(host, hostConfig());
  if (hostClass !== "console" && hostClass !== "partners") return notFound();

  const proto = request.headers.get("x-forwarded-proto");
  const secure = proto ? proto === "https" : request.nextUrl.protocol === "https:";

  let response: NextResponse;
  let policy: string | undefined;
  if (pathname === "/robots.txt") {
    // Consoles are never crawled (07 §1).
    response = new NextResponse(robotsTxt(hostClass), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } else if (pathname.startsWith("/api/")) {
    response = NextResponse.next();
  } else {
    // Per-request nonce; Next.js reads the CSP request header and nonces its scripts.
    const nonce = generateNonce();
    policy = buildCsp({
      nonce,
      dev: process.env.NODE_ENV === "development",
      authEmulator: process.env.NEXT_PUBLIC_USE_AUTH_EMULATOR === "true",
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    });
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", policy);
    const target = new URL(
      `${INTERNAL[hostClass]}${pathname === "/" ? "" : pathname}${search}`,
      request.url,
    );
    response = NextResponse.rewrite(target, { request: { headers: requestHeaders } });
  }

  for (const [key, value] of Object.entries(baseSecurityHeaders("console", secure))) {
    response.headers.set(key, value);
  }
  if (policy) response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
