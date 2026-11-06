import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Unit tests for session verification edge cases that the Auth emulator can't produce
// (stale sign-ins, missing claims). The Admin SDK is mocked.

const auth = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  createSessionCookie: vi.fn(async () => "firebase-cookie"),
  verifySessionCookie: vi.fn(),
  revokeRefreshTokens: vi.fn(),
}));
vi.mock("./firebase-admin", () => ({ getAdminAuth: () => auth }));

const now = () => Math.floor(Date.now() / 1000);
const claims = (over: Record<string, unknown> = {}) => ({
  uid: "u1",
  email: "Raj@Acme.Test",
  email_verified: true,
  auth_time: now(),
  firebase: { sign_in_provider: "password" },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FIREBASE_PROJECT_ID", "demo-crm");
});
afterEach(() => vi.unstubAllEnvs());

describe("session (FR-AUTH-004/008)", () => {
  it("uses __Host- cookie names only over HTTPS", async () => {
    const { sessionPolicy } = await import("./session");
    expect(sessionPolicy("workspace", true).cookieName).toBe("__Host-session");
    expect(sessionPolicy("console", false).cookieName).toBe("console");
    expect(sessionPolicy("partners", true).maxAgeMs).toBe(12 * 60 * 60 * 1000);
  });

  it("accepts a fresh, verified sign-in and normalizes claims", async () => {
    auth.verifyIdToken.mockResolvedValue(claims());
    const { verifyFreshIdToken } = await import("./session");
    await expect(verifyFreshIdToken("t")).resolves.toEqual({
      uid: "u1",
      email: "raj@acme.test",
      emailVerified: true,
      authTime: expect.any(Number),
      signInProvider: "password",
    });
    expect(auth.verifyIdToken).toHaveBeenCalledWith("t", true); // revocation checked
  });

  it("handles tokens without email or provider", async () => {
    auth.verifyIdToken.mockResolvedValue(claims({ email: undefined, firebase: {} }));
    const { verifyFreshIdToken } = await import("./session");
    await expect(verifyFreshIdToken("t")).resolves.toMatchObject({
      email: null,
      signInProvider: null,
    });
  });

  it.each([
    [
      "invalid tokens",
      () => auth.verifyIdToken.mockRejectedValue(new Error("bad")),
      "UNAUTHENTICATED",
    ],
    [
      "unverified emails",
      () => auth.verifyIdToken.mockResolvedValue(claims({ email_verified: false })),
      "FORBIDDEN",
    ],
    [
      "stale sign-ins",
      () => auth.verifyIdToken.mockResolvedValue(claims({ auth_time: now() - 600 })),
      "REAUTH_REQUIRED",
    ],
  ])("rejects %s", async (_label, arrange, code) => {
    arrange();
    const { verifyFreshIdToken } = await import("./session");
    await expect(verifyFreshIdToken("t")).rejects.toMatchObject({ code });
  });

  it("binds minted cookies to surface + host and rejects any other binding", async () => {
    auth.verifySessionCookie.mockResolvedValue(claims());
    const { mintSessionCookie, verifySession } = await import("./session");
    const { cookie } = await mintSessionCookie("t", { kind: "workspace", host: "A.test" }, true);
    expect(cookie.startsWith("firebase-cookie~")).toBe(true);
    await expect(
      verifySession(cookie, { kind: "workspace", host: "a.test" }),
    ).resolves.toMatchObject({
      uid: "u1",
    });
    expect(auth.verifySessionCookie).toHaveBeenCalledWith("firebase-cookie", true);
    await expect(verifySession(cookie, { kind: "workspace", host: "b.test" })).resolves.toBeNull();
    await expect(verifySession(cookie, { kind: "console", host: "a.test" })).resolves.toBeNull();
    await expect(
      verifySession("firebase-cookie", { kind: "workspace", host: "a.test" }),
    ).resolves.toBeNull();
    await expect(
      verifySession(undefined, { kind: "workspace", host: "a.test" }),
    ).resolves.toBeNull();
  });

  it("returns null when Firebase rejects the cookie (revoked, disabled)", async () => {
    const { mintSessionCookie, verifySession } = await import("./session");
    const { cookie } = await mintSessionCookie("t", { kind: "console", host: "c.test" }, false);
    auth.verifySessionCookie.mockRejectedValue(new Error("revoked"));
    await expect(verifySession(cookie, { kind: "console", host: "c.test" })).resolves.toBeNull();
  });

  it("requires a recent sign-in for sensitive operations", async () => {
    const { assertRecentAuth } = await import("./session");
    const session = {
      uid: "u",
      email: null,
      emailVerified: true,
      authTime: 1000,
      signInProvider: null,
    };
    expect(() => assertRecentAuth(session, 1000 * 1000 + 60_000)).not.toThrow();
    expect(() => assertRecentAuth(session, 1000 * 1000 + 600_000)).toThrow(
      expect.objectContaining({ code: "REAUTH_REQUIRED" }),
    );
  });

  it("revokes all refresh tokens on sign-out everywhere", async () => {
    const { revokeAllSessions } = await import("./session");
    await revokeAllSessions("u1");
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith("u1");
  });
});
