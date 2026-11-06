// Security headers and CSP (requirements/04 §10, NFR-SEC-005, T-03-09). Pure — used by
// both apps' proxies so policy lives in one place and is unit-tested.
//
// Decision (Phase 3): authenticated surfaces (workspace + console hosts) use a strict
// nonce-based script policy and render per request; Partial Prerendering cannot carry a
// per-request nonce (Next.js 16 CSP guide). The marketing host stays static with a
// nonce-less policy (no user content there). style-src allows inline styles because
// component libraries set style attributes, which nonces cannot cover.

export interface CspOptions {
  /** Per-request nonce; omit for static marketing pages. */
  nonce?: string | undefined;
  /** next dev needs 'unsafe-eval' for React debugging; never in production builds. */
  dev: boolean;
  /** Allow the local Firebase Auth emulator (local/test only). */
  authEmulator: boolean;
  /** Firebase authDomain, needed for the Google sign-in popup iframe. */
  authDomain?: string | undefined;
  assetsOrigin?: string | undefined;
}

const FIREBASE_AUTH_ORIGINS = [
  "https://identitytoolkit.googleapis.com",
  "https://securetoken.googleapis.com",
  "https://apis.google.com",
  "https://www.googleapis.com",
];

export function buildCsp(opts: CspOptions): string {
  const script = opts.nonce
    ? [`'nonce-${opts.nonce}'`, "'strict-dynamic'"]
    : ["'self'", "'unsafe-inline'"];
  if (opts.dev) script.push("'unsafe-eval'");

  const connect = ["'self'", ...FIREBASE_AUTH_ORIGINS];
  if (opts.authEmulator) connect.push("http://127.0.0.1:9099", "http://localhost:9099");

  const frame = opts.authDomain ? [`https://${opts.authDomain}`] : [];
  const img = ["'self'", "data:", "blob:", ...(opts.assetsOrigin ? [opts.assetsOrigin] : [])];

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", script],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", img],
    ["font-src", ["'self'"]],
    ["connect-src", connect],
    ["frame-src", frame.length ? frame : ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'none'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  const policy = directives.map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!opts.dev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

export type SurfaceClass = "marketing" | "workspace" | "console";

/** Headers applied to every response of a surface (CSP is added separately). */
export function baseSecurityHeaders(
  surface: SurfaceClass,
  secure: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": surface === "marketing" ? "strict-origin-when-cross-origin" : "same-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    // Google sign-in uses a popup that must be able to message back.
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  };
  // HSTS only over HTTPS. Not "preload" until every subdomain is confirmed HTTPS (04 §10).
  if (secure) headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains";
  if (surface !== "marketing") {
    headers["X-Robots-Tag"] = "noindex, nofollow, noarchive";
    // Authenticated surfaces are never stored by shared caches (R-05, TC-SEC-013).
    headers["Cache-Control"] = "private, no-store";
  }
  return headers;
}

/** 128-bit random nonce, base64. Works in Node and edge runtimes. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
