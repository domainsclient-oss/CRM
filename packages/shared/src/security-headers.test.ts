import { describe, expect, it } from "vitest";
import { baseSecurityHeaders, buildCsp, generateNonce } from "./security-headers";

const directive = (csp: string, name: string) =>
  csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("buildCsp (TC-SEC-006)", () => {
  it("uses nonce + strict-dynamic without unsafe-inline/eval for authenticated surfaces", () => {
    const csp = buildCsp({
      nonce: "abc123",
      dev: false,
      authEmulator: false,
      authDomain: "demo.firebaseapp.com",
    });
    const script = directive(csp, "script-src");
    expect(script).toBe("script-src 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'none'");
    expect(directive(csp, "frame-src")).toBe("frame-src https://demo.firebaseapp.com");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("only allows unsafe-eval in development and the emulator only when enabled", () => {
    expect(buildCsp({ nonce: "n", dev: true, authEmulator: false })).toContain("'unsafe-eval'");
    expect(buildCsp({ nonce: "n", dev: false, authEmulator: false })).not.toContain("9099");
    expect(buildCsp({ nonce: "n", dev: false, authEmulator: true })).toContain(
      "http://127.0.0.1:9099",
    );
  });

  it("static marketing policy has no nonce and still forbids framing and plugins", () => {
    const csp = buildCsp({ dev: false, authEmulator: false });
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'unsafe-inline'");
    expect(directive(csp, "frame-src")).toBe("frame-src 'none'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });
});

describe("baseSecurityHeaders", () => {
  it("marks authenticated surfaces private and noindex", () => {
    for (const surface of ["workspace", "console"] as const) {
      const h = baseSecurityHeaders(surface, true);
      expect(h["Cache-Control"]).toBe("private, no-store");
      expect(h["X-Robots-Tag"]).toContain("noindex");
      expect(h["Referrer-Policy"]).toBe("same-origin");
    }
  });

  it("sends HSTS only over HTTPS", () => {
    expect(baseSecurityHeaders("marketing", true)["Strict-Transport-Security"]).toContain(
      "max-age=",
    );
    expect(baseSecurityHeaders("marketing", false)["Strict-Transport-Security"]).toBeUndefined();
  });

  it("marketing pages stay cacheable and indexable here (policy per host in T-08-04)", () => {
    const h = baseSecurityHeaders("marketing", true);
    expect(h["Cache-Control"]).toBeUndefined();
    expect(h["X-Robots-Tag"]).toBeUndefined();
  });
});

describe("generateNonce", () => {
  it("is unique and base64", () => {
    const set = new Set(Array.from({ length: 200 }, generateNonce));
    expect(set.size).toBe(200);
    for (const n of set) expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
