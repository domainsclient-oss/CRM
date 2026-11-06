import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { signInWithPassword } from "@crm/testing/auth-emulator";
import { WORKSPACES } from "@crm/testing/fixtures";
import {
  TEST_PASSWORD,
  addMember,
  createUser,
  resetEmulators,
  seedTenancy,
} from "@crm/testing/seed";
import { clearTenantCaches } from "../contexts/tenant-context";
import { getAdminAuth, getDb } from "../firebase-admin";
import { logger } from "../logger";
import { MemoryRateLimiter, setRateLimiter } from "../rate-limit";
import { createSessionCookie } from "../session";
import { ACTION_REGISTRY, createActionWrappers, type RequestInfo } from "./wrappers";

const HOST = WORKSPACES.acme.canonicalHost;
let counter = 0;
const uniqueName = (base: string) => `${base}.${++counter}`;

function request(
  overrides: Partial<RequestInfo> & { cookies?: Record<string, string> } = {},
): RequestInfo {
  const cookies = overrides.cookies ?? {};
  return {
    host: HOST,
    origin: `http://${HOST}`,
    secure: false,
    ip: "203.0.113.7",
    userAgent: "vitest",
    cookie: (name) => cookies[name],
    ...overrides,
  };
}

async function signedInAs(uid: string, role: "owner" | "member" | "viewer") {
  await createUser(getAdminAuth(), uid);
  await addMember(getDb(), "acme", uid, role);
  const idToken = await signInWithPassword(`${uid}@example.test`, TEST_PASSWORD);
  const { cookie } = await createSessionCookie(idToken, { kind: "workspace", host: HOST }, false);
  return { session: cookie };
}

const schema = z.object({ title: z.string().min(1).max(20) });

beforeEach(async () => {
  await resetEmulators();
  clearTenantCaches();
  setRateLimiter(new MemoryRateLimiter());
  await seedTenancy(getDb());
});

describe("tenant action wrapper", () => {
  it("runs the handler with a server-built context for an authorized user", async () => {
    const cookies = await signedInAs("u_owner", "owner");
    const wrap = createActionWrappers(async () => request({ cookies }));
    const action = wrap.tenant({
      name: uniqueName("test.ok"),
      permission: "record.create",
      schema,
      handler: async (ctx, input) => ({ tenantId: ctx.tenantId, uid: ctx.uid, title: input.title }),
    });
    expect(await action({ title: "Hello" })).toEqual({
      ok: true,
      data: { tenantId: WORKSPACES.acme.id, uid: "u_owner", title: "Hello" },
    });
  });

  it("rejects requests without an Origin header or from another origin (CSRF, TC-SEC-011)", async () => {
    const cookies = await signedInAs("u_owner", "owner");
    for (const origin of [null, "https://evil.test", "null"]) {
      const wrap = createActionWrappers(async () => request({ cookies, origin }));
      const action = wrap.tenant({
        name: uniqueName("test.origin"),
        permission: "record.create",
        schema,
        handler: async () => "should not run",
      });
      expect(await action({ title: "x" })).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
    }
  });

  it("rejects smuggled tenantId / role / ownerUid fields (TC-SEC-002)", async () => {
    const cookies = await signedInAs("u_owner", "owner");
    const wrap = createActionWrappers(async () => request({ cookies }));
    const action = wrap.tenant({
      name: uniqueName("test.strict"),
      permission: "record.create",
      schema,
      handler: async () => "should not run",
    });
    for (const extra of [
      { tenantId: WORKSPACES.initech.id },
      { role: "owner" },
      { ownerUid: "u_x" },
    ]) {
      const result = await action({ title: "x", ...extra });
      expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    }
  });

  it("enforces the permission with the role from Firestore (TC-SEC-004)", async () => {
    const cookies = await signedInAs("u_viewer", "viewer");
    const wrap = createActionWrappers(async () => request({ cookies }));
    const action = wrap.tenant({
      name: uniqueName("test.perm"),
      permission: "record.create",
      schema,
      handler: async () => "should not run",
    });
    expect(await action({ title: "x" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("returns UNAUTHENTICATED without a session and NOT_FOUND on unknown hosts", async () => {
    const anon = createActionWrappers(async () => request());
    const a = anon.tenant({
      name: uniqueName("t.anon"),
      permission: "record.read",
      schema,
      handler: async () => 1,
    });
    expect(await a({ title: "x" })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });

    const unknown = createActionWrappers(async () =>
      request({ host: "nope.example.test", origin: "http://nope.example.test" }),
    );
    const b = unknown.tenant({
      name: uniqueName("t.host"),
      permission: "record.read",
      schema,
      handler: async () => 1,
    });
    expect(await b({ title: "x" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("logs refusals as authz.denied with pseudonymous IDs only (10 §10)", async () => {
    const cookies = await signedInAs("u_viewer", "viewer");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const wrap = createActionWrappers(async () => request({ cookies }));
    const name = uniqueName("test.denied");
    const action = wrap.tenant({
      name,
      permission: "record.delete",
      schema,
      handler: async () => "never",
    });
    expect(await action({ title: "x" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(warn).toHaveBeenCalledWith(
      "authz.denied",
      expect.objectContaining({
        action: name,
        context: "tenant",
        uid: "u_viewer",
        tenantId: WORKSPACES.acme.id,
        reason: "viewer lacks record.delete",
      }),
    );
    warn.mockRestore();
  });

  it("rate-limits per user", async () => {
    const cookies = await signedInAs("u_owner", "owner");
    const wrap = createActionWrappers(async () => request({ cookies }));
    const action = wrap.tenant({
      name: uniqueName("test.rl"),
      permission: "record.create",
      schema,
      rateLimit: { name: "test.rl", limit: 2, windowSeconds: 60 },
      handler: async () => "ok",
    });
    await action({ title: "x" });
    await action({ title: "x" });
    expect(await action({ title: "x" })).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED" },
    });
  });

  it("hides unexpected errors behind INTERNAL with a request ID", async () => {
    const cookies = await signedInAs("u_owner", "owner");
    const wrap = createActionWrappers(async () => request({ cookies }));
    const action = wrap.tenant({
      name: uniqueName("test.crash"),
      permission: "record.create",
      schema,
      handler: async () => {
        throw new Error("db password hunter2 leaked in message");
      },
    });
    const result = await action({ title: "x" });
    expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
    expect(JSON.stringify(result)).not.toContain("hunter2");
    if (!result.ok) expect(result.error.requestId).toMatch(/^req_/);
  });

  it("registers every action and refuses conflicting reuse of a name", () => {
    const wrap = createActionWrappers(async () => request());
    const name = uniqueName("test.registry");
    const rateLimit = { name, limit: 1, windowSeconds: 1 };
    wrap.public({ name, schema, rateLimit, handler: async () => 1 });
    expect(ACTION_REGISTRY.get(name)).toEqual({ name, kind: "public", permission: null });
    // identical re-registration (hot reload) is allowed
    expect(() => wrap.public({ name, schema, rateLimit, handler: async () => 1 })).not.toThrow();
    expect(() =>
      wrap.tenant({ name, schema, permission: "record.read", handler: async () => 1 }),
    ).toThrow(/Duplicate/);
  });
});

describe("public action wrapper", () => {
  it("still requires same-origin and rate-limits by IP", async () => {
    const name = uniqueName("test.public");
    const wrap = createActionWrappers(async () => request());
    const action = wrap.public({
      name,
      schema,
      rateLimit: { name, limit: 1, windowSeconds: 60 },
      handler: async (input) => input.title,
    });
    expect(await action({ title: "a" })).toEqual({ ok: true, data: "a" });
    expect(await action({ title: "a" })).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED" },
    });

    const cross = createActionWrappers(async () => request({ origin: "https://evil.test" }));
    const crossAction = cross.public({
      name: uniqueName("test.public.cross"),
      schema,
      rateLimit: { name: "x", limit: 5, windowSeconds: 60 },
      handler: async () => "no",
    });
    expect(await crossAction({ title: "a" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});
