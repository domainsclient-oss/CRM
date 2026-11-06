import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ACTION_REGISTRY, actionMeta, type RegisteredAction } from "@crm/core/actions";
import { clearTenantCaches } from "@crm/core/contexts/tenant";
import { getAdminAuth, getDb } from "@crm/core/firebase-admin";
import { MemoryRateLimiter, setRateLimiter } from "@crm/core/rate-limit";
import { createSessionCookie, sessionPolicy, type SessionKind } from "@crm/core/session";
import {
  AGENCY_ROLES,
  PLATFORM_ROLES,
  WORKSPACE_ROLES,
  agencyAllows,
  platformAllows,
  workspaceScope,
  type AgencyPermission,
  type PlatformPermission,
  type WorkspacePermission,
} from "@crm/shared/permissions";
import { signInWithGoogle, signInWithPassword } from "@crm/testing/auth-emulator";
import { AGENCIES, WORKSPACES, uidFor } from "@crm/testing/fixtures";
import {
  TEST_PASSWORD,
  addMember,
  createUser,
  resetEmulators,
  seedTenancy,
} from "@crm/testing/seed";
import { setRequest } from "./fake-actions";

// Registry-driven isolation suite (requirements/09 §5, TC-SEC-002/004, T-03-07). Loads EVERY
// Server Action module in every app and, for each exported action, proves the wrapper refuses
// cross-origin calls, anonymous calls, callers whose role lacks the permission, callers from
// another tenant, and smuggled input keys. A new action is covered the moment it is exported.

type Action = ((raw: unknown) => Promise<{ ok: boolean; error?: { code: string } }>) & {
  meta: RegisteredAction;
};

const modules = import.meta.glob<Record<string, unknown>>(
  "../../apps/*/src/features/**/actions.ts",
  { eager: true },
);

const exported: Array<{ id: string; fn: unknown }> = Object.entries(modules).flatMap(
  ([path, mod]) =>
    Object.entries(mod).map(([name, fn]) => ({ id: `${path.replace("../../", "")}#${name}`, fn })),
);

const ACTIONS = exported.flatMap(({ id, fn }) => {
  const meta = actionMeta(fn);
  return meta ? [{ id, action: Object.assign(fn as Action, { meta }) }] : [];
});

const ACME = WORKSPACES.acme.canonicalHost;
const CONSOLE = "console.localhost:3001";
const PARTNERS = "partners.localhost:3001";
const HOST_FOR: Record<RegisteredAction["kind"], string> = {
  tenant: ACME,
  agency: PARTNERS,
  platform: CONSOLE,
  public: ACME,
};
const COOKIE_FOR: Record<Exclude<RegisteredAction["kind"], "public">, SessionKind> = {
  tenant: "workspace",
  agency: "partners",
  platform: "console",
};

function call(
  action: Action,
  opts: { session?: string | undefined; origin?: string | null; input?: unknown } = {},
) {
  const { meta } = action;
  const host = HOST_FOR[meta.kind];
  const cookies: Record<string, string> = {};
  if (opts.session && meta.kind !== "public") {
    cookies[sessionPolicy(COOKIE_FOR[meta.kind], false).cookieName] = opts.session;
  }
  setRequest({
    host,
    origin: opts.origin === undefined ? `http://${host}` : opts.origin,
    secure: false,
    ip: "203.0.113.9",
    userAgent: "vitest",
    cookie: (name) => cookies[name],
  });
  return action(opts.input ?? {});
}

async function passwordSession(uid: string, kind: SessionKind): Promise<string> {
  const idToken = await signInWithPassword(`${uid}@example.test`, TEST_PASSWORD);
  const host = { workspace: ACME, partners: PARTNERS, console: CONSOLE }[kind];
  return (await createSessionCookie(idToken, { kind, host }, false)).cookie;
}

async function staff(uid: string, role: (typeof AGENCY_ROLES)[number]) {
  await createUser(getAdminAuth(), uid);
  const agencyId = AGENCIES.agencyOne.id;
  await getDb()
    .doc(`agencies/${agencyId}/staff/${uid}`)
    .set({ uid, agencyId, email: `${uid}@example.test`, displayName: uid, role, status: "active" });
  await getDb()
    .doc(`users/${uid}`)
    .set({ agencyIds: [agencyId], tenantIds: [] }, { merge: true });
  return passwordSession(uid, "partners");
}

async function platformStaff(sub: string, role: (typeof PLATFORM_ROLES)[number] | null) {
  const { idToken, uid } = await signInWithGoogle({ sub, email: `${sub}@example.com` });
  if (role)
    await getDb()
      .doc(`platformAdmins/${uid}`)
      .set({ role, email: `${sub}@example.com` });
  return (await createSessionCookie(idToken, { kind: "console", host: CONSOLE }, false)).cookie;
}

const sessions = {
  workspace: {} as Record<(typeof WORKSPACE_ROLES)[number], string>,
  agency: {} as Record<(typeof AGENCY_ROLES)[number], string>,
  platform: {} as Record<(typeof PLATFORM_ROLES)[number], string>,
  otherTenantOwner: "",
  workspaceUserOnPartners: "",
  googleUserWithoutRole: "",
};

beforeAll(async () => {
  await resetEmulators();
  clearTenantCaches();
  await seedTenancy(getDb());
  for (const role of WORKSPACE_ROLES) {
    const uid = uidFor("acme", role);
    await createUser(getAdminAuth(), uid);
    await addMember(getDb(), "acme", uid, role);
    sessions.workspace[role] = await passwordSession(uid, "workspace");
  }
  const outsider = uidFor("initech", "owner");
  await createUser(getAdminAuth(), outsider);
  await addMember(getDb(), "initech", outsider, "owner");
  sessions.otherTenantOwner = await passwordSession(outsider, "workspace");
  sessions.workspaceUserOnPartners = await passwordSession(uidFor("acme", "owner"), "partners");

  sessions.agency.agency_owner = await staff("u_staff_owner", "agency_owner");
  sessions.agency.agency_admin = await staff("u_staff_admin", "agency_admin");

  sessions.platform.superadmin = await platformStaff("g-super", "superadmin");
  sessions.platform.support = await platformStaff("g-support", "support");
  sessions.googleUserWithoutRole = await platformStaff("g-nobody", null);
}, 60_000);

beforeEach(() => {
  setRateLimiter(new MemoryRateLimiter());
});

/** A session for the most privileged identity of the action's kind. */
function privileged(meta: RegisteredAction): string | undefined {
  if (meta.kind === "tenant") return sessions.workspace.owner;
  if (meta.kind === "agency") return sessions.agency.agency_owner;
  if (meta.kind === "platform") return sessions.platform.superadmin;
  return undefined;
}

type Caller = [label: string, session: () => string];
const caller = (label: string, session: () => string): Caller => [label, session];

/** Callers whose role lacks the action's permission, per the permission matrix. Sessions are
 * read lazily: test names are collected before beforeAll creates them. */
function unauthorized(meta: RegisteredAction): Caller[] {
  if (meta.kind === "tenant") {
    const permission = meta.permission as WorkspacePermission;
    return [
      ...WORKSPACE_ROLES.filter((r) => workspaceScope(r, permission) === null).map((r) =>
        caller(`workspace ${r}`, () => sessions.workspace[r]),
      ),
      caller("owner of another tenant", () => sessions.otherTenantOwner),
    ];
  }
  if (meta.kind === "agency") {
    const permission = meta.permission as AgencyPermission;
    return [
      ...AGENCY_ROLES.filter((r) => !agencyAllows(r, permission)).map((r) =>
        caller(`agency ${r}`, () => sessions.agency[r]),
      ),
      caller("workspace user without staff record", () => sessions.workspaceUserOnPartners),
    ];
  }
  if (meta.kind === "platform") {
    const permission = meta.permission as PlatformPermission;
    return [
      ...PLATFORM_ROLES.filter((r) => !platformAllows(r, permission)).map((r) =>
        caller(`platform ${r}`, () => sessions.platform[r]),
      ),
      caller(
        "allowlisted Google user without platformAdmins record",
        () => sessions.googleUserWithoutRole,
      ),
    ];
  }
  return [];
}

describe("action registry", () => {
  it("finds the Server Action modules of every app", () => {
    const apps = new Set(Object.keys(modules).map((p) => p.split("/")[3]));
    expect([...apps].sort()).toEqual(["console", "web"]);
    expect(ACTIONS.length).toBeGreaterThan(0);
  });

  it("every export of an actions module is a wrapped action (AGENTS.md rule 3)", () => {
    const unwrapped = exported.filter(({ fn }) => !actionMeta(fn)).map(({ id }) => id);
    expect(unwrapped).toEqual([]);
  });

  it("every registered action is exported from an app", () => {
    const exportedNames = new Set(ACTIONS.map((a) => a.action.meta.name));
    expect([...ACTION_REGISTRY.keys()].filter((n) => !exportedNames.has(n))).toEqual([]);
  });

  it("only public actions skip the permission check", () => {
    for (const { action } of ACTIONS) {
      expect(action.meta.permission === null).toBe(action.meta.kind === "public");
    }
  });
});

describe.each(ACTIONS.map(({ id, action }) => [`${action.meta.name} (${id})`, action] as const))(
  "%s",
  (_label, action) => {
    const { meta } = action;

    it("refuses calls without an Origin header or from another origin (TC-SEC-011)", async () => {
      for (const origin of [null, "https://evil.test", "null"]) {
        const result = await call(action, { session: privileged(meta), origin });
        expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      }
    });

    if (meta.kind !== "public") {
      it("refuses anonymous calls", async () => {
        expect(await call(action)).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
      });

      it("refuses forged session cookies", async () => {
        expect(await call(action, { session: "forged.cookie.value" })).toMatchObject({
          ok: false,
          error: { code: "UNAUTHENTICATED" },
        });
      });

      for (const [label, session] of unauthorized(meta)) {
        it(`refuses ${label} (TC-SEC-002/004)`, async () => {
          expect(await call(action, { session: session() })).toMatchObject({
            ok: false,
            error: { code: "FORBIDDEN" },
          });
        });
      }
    }

    it("rejects smuggled scope keys even for the most privileged caller", async () => {
      const result = await call(action, {
        session: privileged(meta),
        input: { tenantId: WORKSPACES.globex.id, agencyId: AGENCIES.agencyTwo.id, role: "owner" },
      });
      expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
      const fieldErrors = (result.error as { fieldErrors?: Record<string, string[]> }).fieldErrors;
      expect(fieldErrors?._form?.join(" ")).toMatch(/Unrecognized key/);
    });
  },
);
