import { beforeEach, describe, expect, it } from "vitest";
import { signInWithGoogle, signInWithPassword } from "@crm/testing/auth-emulator";
import { AGENCIES, WORKSPACES } from "@crm/testing/fixtures";
import {
  TEST_PASSWORD,
  addMember,
  createUser,
  resetEmulators,
  seedTenancy,
} from "@crm/testing/seed";
import { clearTenantCaches, requireTenantContext } from "./contexts/tenant-context";
import { getAdminAuth, getDb } from "./firebase-admin";
import { MemoryRateLimiter, setRateLimiter } from "./rate-limit";
import { verifySession } from "./session";
import {
  CSRF_HEADER,
  handleCreateSession,
  handleDeleteSession,
  readCookie,
  serializeCookie,
} from "./session-http";

// Session Route Handlers (FR-AUTH-004/006): CSRF header + Origin, host-class routing, cookie
// attributes, rate limits, sign-out (TC-AUTH-004, TC-SEC-011).

const ACME = WORKSPACES.acme.canonicalHost;
const CONSOLE = "console.localhost:3001";
const PARTNERS = "partners.localhost:3001";

function request(
  method: "POST" | "DELETE",
  host: string,
  opts: {
    body?: unknown;
    origin?: string | null;
    csrf?: boolean;
    cookie?: string;
    ip?: string;
  } = {},
) {
  const headers = new Headers({ host, "content-type": "application/json" });
  if (opts.csrf !== false) headers.set(CSRF_HEADER, "1");
  const origin = opts.origin === undefined ? `http://${host}` : opts.origin;
  if (origin) headers.set("origin", origin);
  if (opts.cookie) headers.set("cookie", opts.cookie);
  headers.set("x-forwarded-for", opts.ip ?? "203.0.113.50");
  return new Request(`http://${host}/api/auth/session`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
}

const cookieOf = (res: Response) => res.headers.get("set-cookie") ?? "";
const valueOf = (setCookie: string) => setCookie.split(";")[0]!.split("=").slice(1).join("=");

beforeEach(async () => {
  await resetEmulators();
  await seedTenancy(getDb());
  setRateLimiter(new MemoryRateLimiter());
  clearTenantCaches();
});

describe("workspace sessions", () => {
  async function member() {
    await createUser(getAdminAuth(), "u_dana");
    await addMember(getDb(), "acme", "u_dana", "member");
    return signInWithPassword("u_dana@example.test", TEST_PASSWORD);
  }

  it("issues an httpOnly, host-bound cookie that works on that host only", async () => {
    const res = await handleCreateSession(
      request("POST", ACME, { body: { idToken: await member() } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const set = cookieOf(res);
    // Non-localhost hosts are treated as HTTPS: the __Host- prefix pins the cookie to this host.
    expect(set).toMatch(/^__Host-session=/);
    expect(set).toContain("Secure");
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Path=/");
    expect(set).not.toContain("Domain=");
    const cookie = valueOf(set);
    await expect(
      requireTenantContext({ host: ACME, sessionCookie: cookie, requestId: "r" }),
    ).resolves.toMatchObject({ uid: "u_dana" });
  });

  it("signs out everywhere and clears the cookie", async () => {
    const created = await handleCreateSession(
      request("POST", ACME, { body: { idToken: await member() } }),
    );
    const cookie = valueOf(cookieOf(created));
    await new Promise((r) => setTimeout(r, 1100)); // revocation is second-granular
    const res = await handleDeleteSession(
      request("DELETE", ACME, { cookie: `__Host-session=${cookie}` }),
    );
    expect(res.status).toBe(200);
    expect(cookieOf(res)).toContain("Max-Age=0");
    expect(await verifySession(cookie, { kind: "workspace", host: ACME })).toBeNull();
    // Idempotent without a cookie.
    expect((await handleDeleteSession(request("DELETE", ACME))).status).toBe(200);
  });

  it("refuses non-members (no cookie is minted)", async () => {
    await createUser(getAdminAuth(), "u_out");
    const idToken = await signInWithPassword("u_out@example.test", TEST_PASSWORD);
    const res = await handleCreateSession(request("POST", ACME, { body: { idToken } }));
    expect(res.status).toBe(403);
    expect(cookieOf(res)).toBe("");
  });
});

describe("request checks (TC-SEC-011)", () => {
  it.each([
    ["missing CSRF header", { csrf: false }],
    ["cross-origin", { origin: "https://evil.test" }],
    ["no Origin", { origin: null }],
  ] as const)("rejects %s", async (_label, opts) => {
    const res = await handleCreateSession(
      request("POST", ACME, { body: { idToken: "x" }, ...opts }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("rejects malformed bodies and unknown keys", async () => {
    for (const body of [{}, { idToken: "x".repeat(20), role: "owner" }]) {
      const res = await handleCreateSession(request("POST", ACME, { body }));
      expect(res.status).toBe(400);
    }
  });

  it("has no sessions on the marketing host", async () => {
    const res = await handleCreateSession(
      request("POST", "www.localhost:3000", { body: { idToken: "x" } }),
    );
    expect(res.status).toBe(404);
  });

  it("rate-limits sign-ins per IP with Retry-After", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await handleCreateSession(
        request("POST", ACME, { body: { idToken: "not-a-token-value" }, ip: "198.51.100.7" }),
      );
    }
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("request metadata", () => {
  it("requires a Host header", async () => {
    const res = await handleCreateSession(
      new Request("http://x/api/auth/session", { method: "POST", headers: { [CSRF_HEADER]: "1" } }),
    );
    expect(res.status).toBe(404);
  });

  it("honours X-Forwarded-Proto and falls back to X-Real-IP for rate limiting", async () => {
    const headers = (ip: string) =>
      new Headers({
        host: "acme.localhost:3000",
        origin: "http://acme.localhost:3000",
        [CSRF_HEADER]: "1",
        "x-forwarded-proto": "https",
        "x-real-ip": ip,
      });
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await handleCreateSession(
        new Request("http://acme.localhost:3000/api/auth/session", {
          method: "POST",
          headers: headers("192.0.2.77"),
          body: "{}",
        }),
      );
    }
    expect(last!.status).toBe(429);
    const other = await handleCreateSession(
      new Request("http://acme.localhost:3000/api/auth/session", {
        method: "POST",
        headers: headers("192.0.2.78"),
        body: "{}",
      }),
    );
    expect(other.status).not.toBe(429);
  });
});

describe("console sessions (FR-AUTH-008)", () => {
  it("platform staff with Google get a console cookie and a login record", async () => {
    const { idToken, uid } = await signInWithGoogle({ sub: "g-ops", email: "ops@example.com" });
    await getDb()
      .doc(`platformAdmins/${uid}`)
      .set({ role: "superadmin", email: "ops@example.com" });
    const res = await handleCreateSession(request("POST", CONSOLE, { body: { idToken } }));
    expect(res.status).toBe(200);
    expect(cookieOf(res)).toMatch(/^console=/); // localhost: no __Host- prefix
    expect((await getDb().collection("privilegedSessions").get()).size).toBe(1);
  });

  it("refuses password sign-ins on the platform console", async () => {
    await createUser(getAdminAuth(), "u_pw");
    await getDb()
      .doc("platformAdmins/u_pw")
      .set({ role: "superadmin", email: "u_pw@example.test" });
    const idToken = await signInWithPassword("u_pw@example.test", TEST_PASSWORD);
    expect(
      (await handleCreateSession(request("POST", CONSOLE, { body: { idToken } }))).status,
    ).toBe(403);
  });

  it("agency staff get a partners cookie; non-staff are refused", async () => {
    await createUser(getAdminAuth(), "u_staff");
    await getDb()
      .doc(`agencies/${AGENCIES.agencyOne.id}/staff/u_staff`)
      .set({ uid: "u_staff", role: "agency_admin", status: "active", email: "s@a.test" });
    await getDb()
      .doc("users/u_staff")
      .set({ agencyIds: [AGENCIES.agencyOne.id], tenantIds: [] }, { merge: true });
    const ok = await handleCreateSession(
      request("POST", PARTNERS, {
        body: { idToken: await signInWithPassword("u_staff@example.test", TEST_PASSWORD) },
      }),
    );
    expect(ok.status).toBe(200);
    expect(cookieOf(ok)).toMatch(/^partners=/);

    await createUser(getAdminAuth(), "u_nobody");
    const denied = await handleCreateSession(
      request("POST", PARTNERS, {
        body: { idToken: await signInWithPassword("u_nobody@example.test", TEST_PASSWORD) },
      }),
    );
    expect(denied.status).toBe(403);
  });
});

describe("cookie helpers", () => {
  it("serializes Secure cookies and parses cookie headers", () => {
    expect(serializeCookie("__Host-session", "v", { maxAgeSeconds: 60, secure: true })).toBe(
      "__Host-session=v; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure",
    );
    expect(readCookie("a=1; session=x=y; b=2", "session")).toBe("x=y");
    expect(readCookie(null, "session")).toBeUndefined();
    expect(readCookie("a=1", "session")).toBeUndefined();
  });
});
