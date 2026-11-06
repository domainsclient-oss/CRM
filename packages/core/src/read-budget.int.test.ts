import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocumentReference, Firestore, Query, Transaction } from "firebase-admin/firestore";
import type { WorkspaceRole } from "@crm/shared/permissions";
import { contactInput, dealInput, taskInput } from "@crm/shared/records/schemas";
import { parseListParams } from "@crm/shared/records/list-specs";
import { PEOPLE, WORKSPACES, uidFor } from "@crm/testing/fixtures";
import { addMember, createUser, resetEmulators, seedTenancy } from "@crm/testing/seed";
import { getPublicBranding } from "./branding/resolve";
import { getEffectiveConfig } from "./config/entitlements";
import { usageBanner } from "./config/usage";
import {
  clearTenantCaches,
  requireTenantContext,
  type TenantContext,
} from "./contexts/tenant-context";
import { getAdminAuth, getDb } from "./firebase-admin";
import { logger } from "./logger";
import type { TenantDoc } from "./model";
import { unreadCount } from "./notifications";
import { MemoryRateLimiter, setRateLimiter } from "./rate-limit";
import { listTimeline } from "./records/activities";
import { getContact, saveContact } from "./records/contacts";
import { loadBoard, saveDeal } from "./records/deals";
import { listRecords } from "./records/list";
import { globalSearch } from "./records/search";
import { myDueTaskCount, saveTask } from "./records/tasks";
import { getProfile } from "./records/workspace-data";
import { getDashboard } from "./reports";
import { createSessionCookie } from "./session";
import { listUserWorkspaces } from "./services/workspaces";
import { signInWithPassword } from "@crm/testing/auth-emulator";
import { TEST_PASSWORD } from "@crm/testing/seed";

// Read budgets per view (03 §11, NFR-COST-001, T-08-06). Counts billed document reads by
// instrumenting the Admin SDK: one read per returned document, minimum one per query, and one
// per aggregation (≤ 1000 index entries). Measured warm (host cache populated), as in steady state.

let reads = 0;
const restore: Array<() => void> = [];
function instrument<T extends object>(
  proto: T,
  method: keyof T,
  count: (result: unknown) => number,
) {
  const original = proto[method] as unknown as (...args: unknown[]) => Promise<unknown>;
  (proto as Record<keyof T, unknown>)[method] = async function (this: unknown, ...args: unknown[]) {
    const result = await original.apply(this, args);
    reads += count(result);
    return result;
  };
  restore.push(() => ((proto as Record<keyof T, unknown>)[method] = original));
}
const docsIn = (snap: unknown) => {
  const s = snap as { size?: number; docs?: unknown[] } | unknown[];
  if (Array.isArray(s)) return s.length;
  return Math.max(1, s.size ?? s.docs?.length ?? 1);
};

async function measure(fn: () => Promise<unknown>): Promise<number> {
  reads = 0;
  await fn();
  return reads;
}

const ACME = WORKSPACES.acme;
const OWNER = uidFor("acme", "owner");
const RAJ = PEOPLE.raj.uid;

async function ctx(uid: string, role: WorkspaceRole): Promise<TenantContext> {
  const tenant = (await getDb().doc(`tenants/${ACME.id}`).get()).data() as TenantDoc;
  return {
    tenantId: ACME.id,
    agencyId: ACME.agencyId,
    uid,
    role,
    session: { uid, authTime: Math.floor(Date.now() / 1000) } as never,
    tenant,
    requestId: "req_budget",
    log: logger,
  };
}

const results: Array<[string, number, number]> = [];

beforeAll(async () => {
  await resetEmulators();
  await seedTenancy(getDb());
  await createUser(getAdminAuth(), OWNER);
  await addMember(getDb(), "acme", OWNER, "owner");
  await addMember(getDb(), "acme", RAJ, "member");
  await getDb()
    .doc(`users/${OWNER}`)
    .set({ tenantIds: [ACME.id], agencyIds: [] }, { merge: true });
  await getDb().doc(`tenants/${ACME.id}`).update({ ownerUid: OWNER });
  setRateLimiter(new MemoryRateLimiter());
  clearTenantCaches();

  const owner = await ctx(OWNER, "owner");
  for (let i = 0; i < 40; i++) {
    const contact = await saveContact(
      owner,
      null,
      contactInput.parse({ firstName: `Person${i}`, lastName: "Budget", email: `p${i}@acme.test` }),
    );
    if (i < 30) {
      await saveDeal(
        owner,
        null,
        dealInput.parse({ name: `Deal ${i}`, stageId: "stg_proposal", amount: String(1000 + i) }),
      );
    }
    if (i < 12) {
      await saveTask(
        owner,
        null,
        taskInput.parse({
          title: `Follow up ${i}`,
          dueDate: "2026-10-10",
          related: { type: "contact", id: contact.id },
        }),
      );
    }
  }

  instrument(Query.prototype, "get", docsIn);
  // AggregateQuery is not a runtime export; take its prototype from an instance.
  instrument(
    Object.getPrototypeOf(getDb().collection("_").count()) as object,
    "get" as never,
    () => 1,
  );
  instrument(Transaction.prototype, "get", docsIn);
  instrument(Transaction.prototype, "getAll", docsIn);
  // DocumentReference.get delegates to Firestore.getAll, so single-document reads count here.
  instrument(Firestore.prototype, "getAll", docsIn);
}, 120_000);

afterAll(() => {
  for (const undo of restore.reverse()) undo();
  // The cost review (requirements/tasks/T-08-06-cost-review.md) quotes these numbers.
  console.table(results.map(([view, n, max]) => ({ view, reads: n, budget: max })));
});

function check(view: string, n: number, max: number) {
  results.push([view, n, max]);
  expect(n, view).toBeLessThanOrEqual(max);
}

describe("read budgets per view (03 §11)", () => {
  it("request overhead: tenant (cached) + membership ≤ 1", async () => {
    const idToken = await signInWithPassword(`${OWNER}@example.test`, TEST_PASSWORD);
    const { cookie } = await createSessionCookie(
      idToken,
      { kind: "workspace", host: ACME.canonicalHost },
      false,
    );
    const input = { host: ACME.canonicalHost, sessionCookie: cookie, requestId: "req_budget" };
    await requireTenantContext(input); // warm the 60 s host cache
    check("request overhead", await measure(() => requireTenantContext(input)), 1);
  });

  it("app shell (branding, config, badges, profile, switcher)", async () => {
    const owner = await ctx(OWNER, "owner");
    await getPublicBranding(ACME.canonicalHost);
    const n = await measure(() =>
      Promise.all([
        getPublicBranding(ACME.canonicalHost),
        getEffectiveConfig(owner),
        usageBanner(owner),
        unreadCount(owner),
        myDueTaskCount(owner),
        getProfile(owner),
        listUserWorkspaces(OWNER),
      ]),
    );
    // Not in 03 §11; budgeted here so it can't silently grow.
    check("app shell", n, 12);
  });

  it("list page (25 rows) ≤ 26 + 1 count", async () => {
    const owner = await ctx(OWNER, "owner");
    const params = parseListParams("contacts", {});
    check("list page — owner", await measure(() => listRecords(owner, "contacts", params)), 27);
    const raj = await ctx(RAJ, "member");
    check(
      "list page — member (own scope)",
      await measure(() => listRecords(raj, "contacts", params)),
      27,
    );
  });

  it("record detail ≤ 35", async () => {
    const owner = await ctx(OWNER, "owner");
    const first = await listRecords<{ id: string }>(
      owner,
      "contacts",
      parseListParams("contacts", {}),
    );
    const id = first.items[0]!.id;
    const n = await measure(() =>
      Promise.all([getContact(owner, id), listTimeline(owner, "contact", id, null)]),
    );
    check("record detail", n, 35);
  });

  it("dashboard ≤ 35 read-equivalents", async () => {
    const owner = await ctx(OWNER, "owner");
    check("dashboard", await measure(() => getDashboard(owner, { ownerUid: null })), 35);
  });

  it("kanban board ≤ 305 (20 cards per column)", async () => {
    const owner = await ctx(OWNER, "owner");
    check("kanban board", await measure(() => loadBoard(owner)), 305);
  });

  it("global search keystroke ≤ 20", async () => {
    const owner = await ctx(OWNER, "owner");
    check("global search", await measure(() => globalSearch(owner, "person1 budget")), 20);
  });

  it("notification poll = 1", async () => {
    const owner = await ctx(OWNER, "owner");
    check("notification poll", await measure(() => unreadCount(owner)), 1);
  });
});
