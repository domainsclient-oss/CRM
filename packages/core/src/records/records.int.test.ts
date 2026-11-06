import { beforeEach, describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { parseListParams } from "@crm/shared/records/list-specs";
import {
  activityInput,
  companyInput,
  contactInput,
  dealInput,
  leadInput,
  taskInput,
} from "@crm/shared/records/schemas";
import {
  PEOPLE,
  WORKSPACES,
  buildWorkspace,
  uidFor,
  type WorkspaceKey,
} from "@crm/testing/fixtures";
import { addMember, resetEmulators, seedTenancy } from "@crm/testing/seed";
import type { WorkspaceRole } from "@crm/shared/permissions";
import type { TenantContext } from "../contexts/tenant-context";
import { getDb } from "../firebase-admin";
import { logger } from "../logger";
import type { TenantDoc } from "../model";
import { getById } from "../repositories/base";
import { listTimeline, logActivity, deleteActivity } from "./activities";
import { findDuplicateCompany, getCompany, saveCompany } from "./companies";
import { findDuplicateContact, getContact, saveContact } from "./contacts";
import {
  closeDeal,
  getDeal,
  loadBoard,
  moveDealStage,
  reopenDeal,
  saveDeal,
  updatePipeline,
} from "./deals";
import { convertLead, getLead, saveLead } from "./leads";
import { listRecords, type ListPage } from "./list";
import { listMyTasks, myDueTaskCount, saveTask, setTaskDone } from "./tasks";
import {
  listTrash,
  purgeExpiredTrash,
  purgeRecord,
  reassignRecord,
  restoreRecord,
  softDeleteRecord,
} from "./trash";
import { getProfile, listTags, updateProfile, updateTenantSettings } from "./workspace-data";

// Record layer against the Firestore emulator (T-04-01..11, TC-RBAC-004, TC-SRCH-002, TC-REC-001,
// TC-LEAD-002, TC-DEAL-003/004, TC-TASK-001/002, TC-ACT-001).

const RAJ = PEOPLE.raj.uid; // member
const LENA = PEOPLE.lena.uid; // member
const OWNER = uidFor("acme", "owner");
const MANAGER = uidFor("acme", "manager");
const VIEWER = uidFor("acme", "viewer");

function ctxFor(uid: string, role: WorkspaceRole, ws: WorkspaceKey = "acme"): TenantContext {
  return {
    tenantId: WORKSPACES[ws].id,
    agencyId: WORKSPACES[ws].agencyId,
    uid,
    role,
    session: { uid, authTime: Math.floor(Date.now() / 1000) } as never,
    tenant: buildWorkspace(ws) as unknown as TenantDoc,
    requestId: "req_test",
    log: logger,
  };
}

const owner = () => ctxFor(OWNER, "owner");
const manager = () => ctxFor(MANAGER, "manager");
const raj = () => ctxFor(RAJ, "member");
const lena = () => ctxFor(LENA, "member");
const viewer = () => ctxFor(VIEWER, "viewer");

const contact = (firstName: string, extra: Record<string, unknown> = {}) =>
  contactInput.parse({ firstName, ...extra });

beforeEach(async () => {
  await resetEmulators();
  await seedTenancy(getDb());
  const db = getDb();
  await addMember(db, "acme", OWNER, "owner");
  await addMember(db, "acme", MANAGER, "manager");
  await addMember(db, "acme", RAJ, "member");
  await addMember(db, "acme", LENA, "member");
  await addMember(db, "acme", VIEWER, "viewer");
  await addMember(db, "globex", uidFor("globex", "owner"), "owner");
});

describe("create, update, and own-only visibility (FR-RBAC-004, TC-RBAC-004)", () => {
  it("Members see and open only their own records; others get 404", async () => {
    const { id: rajsId } = await saveContact(raj(), null, contact("Rita"));
    const { id: lenasId } = await saveContact(lena(), null, contact("Leo"));

    const rajList = await listRecords(raj(), "contacts", parseListParams("contacts", {}));
    expect(rajList.items.map((c) => c.id)).toEqual([rajsId]);
    expect(rajList.total).toBe(1);

    await expect(getContact(raj(), lenasId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Asking for Lena's records through the owner filter matches nothing.
    const filtered = await listRecords(
      raj(),
      "contacts",
      parseListParams("contacts", { filter: "owner", value: LENA }),
    );
    expect(filtered.items).toEqual([]);

    const mgrList = await listRecords(manager(), "contacts", parseListParams("contacts", {}));
    expect(mgrList.items.map((c) => c.id).sort()).toEqual([rajsId, lenasId].sort());
    const viewerList = await listRecords(viewer(), "contacts", parseListParams("contacts", {}));
    expect(viewerList.total).toBe(2);
  });

  it("other tenants never see the records", async () => {
    const { id } = await saveContact(owner(), null, contact("Acme person"));
    const globex = ctxFor(uidFor("globex", "owner"), "owner", "globex");
    await expect(getContact(globex, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listRecords(globex, "contacts", parseListParams("contacts", {}))).total).toBe(0);
  });

  it("Members can't edit or delete someone else's record, and reassignment removes access", async () => {
    const { id } = await saveContact(raj(), null, contact("Rita"));
    const loaded = await getContact(raj(), id);
    await expect(
      saveContact(lena(), { id, expectedUpdatedAt: loaded.updatedAt }, contact("Hijack")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(softDeleteRecord(lena(), "contact", id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    await expect(reassignRecord(raj(), "contact", id, LENA)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await reassignRecord(manager(), "contact", id, LENA);
    await expect(getContact(raj(), id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getContact(lena(), id)).resolves.toMatchObject({ ownerUid: LENA });
  });

  it("owners must be active, non-viewer members; Members can't assign others", async () => {
    await expect(saveContact(raj(), null, contact("X", { ownerUid: LENA }))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      saveContact(manager(), null, contact("X", { ownerUid: VIEWER })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      saveContact(manager(), null, contact("X", { ownerUid: "u_nobody" })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const { id } = await saveContact(manager(), null, contact("X", { ownerUid: RAJ }));
    await expect(getContact(raj(), id)).resolves.toMatchObject({ ownerUid: RAJ });
  });

  it("viewers can't create", async () => {
    await expect(saveContact(viewer(), null, contact("V"))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects stale edits (optimistic concurrency)", async () => {
    const { id } = await saveContact(owner(), null, contact("Ann"));
    const v1 = await getContact(owner(), id);
    await saveContact(owner(), { id, expectedUpdatedAt: v1.updatedAt }, contact("Anne"));
    await expect(
      saveContact(owner(), { id, expectedUpdatedAt: v1.updatedAt }, contact("Annie")),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("references must be visible to the actor", async () => {
    const { id: companyId } = await saveCompany(
      lena(),
      null,
      companyInput.parse({ name: "Lena Co" }),
    );
    await expect(saveContact(raj(), null, contact("R", { companyId }))).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("audits changes and writes system activities", async () => {
    const { id } = await saveContact(owner(), null, contact("Sam", { lifecycleStage: "lead" }));
    const v1 = await getContact(owner(), id);
    await saveContact(
      owner(),
      { id, expectedUpdatedAt: v1.updatedAt },
      contact("Sam", { lifecycleStage: "customer" }),
    );
    const timeline = await listTimeline(owner(), "contact", id, null);
    expect(timeline.items.map((a) => a.systemEvent)).toEqual([
      "contact.lifecycle_changed",
      "record.created",
    ]);
    expect(timeline.items[0]!.metadata).toEqual({ from: "lead", to: "customer" });
    const audits = await getDb()
      .collection(`tenants/${WORKSPACES.acme.id}/auditLogs`)
      .where("target.id", "==", id)
      .get();
    const updated = audits.docs.find((d) => d.get("action") === "record.updated");
    expect(updated?.get("changedFields")).toEqual(["lifecycleStage"]);
    expect(JSON.stringify(audits.docs.map((d) => d.data()))).not.toContain("Sam");
  });
});

describe("lists: filters, sort, cursor pagination (FR-SRCH-002, TC-SRCH-002)", () => {
  it("pages forward without duplicates or gaps under concurrent inserts", async () => {
    for (let i = 0; i < 12; i++) {
      await saveContact(owner(), null, contact(`Person ${String(i).padStart(2, "0")}`));
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const params = parseListParams("contacts", { sort: "name", size: "5" });
      const page: ListPage<Record<string, unknown>> = await listRecords(owner(), "contacts", {
        ...params,
        cursor,
      });
      seen.push(...page.items.map((c) => String(c.firstName)));
      cursor = page.nextCursor;
      // A concurrent insert sorting before the cursor must not shift later pages.
      if (pages === 0) await saveContact(owner(), null, contact("Aaron"));
      pages++;
    } while (cursor && pages < 10);
    const expected = Array.from({ length: 12 }, (_, i) => `Person ${String(i).padStart(2, "0")}`);
    expect(seen.filter((n) => n !== "Aaron")).toEqual(expected);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("ignores tampered cursors and cursors from another query shape", async () => {
    for (let i = 0; i < 3; i++) await saveContact(owner(), null, contact(`P${i}`));
    const first = await listRecords(owner(), "contacts", {
      ...parseListParams("contacts", { sort: "name" }),
      pageSize: 1,
    });
    const cursor = first.nextCursor!;
    const tampered = `${cursor.slice(0, -2)}xx`;
    const again = await listRecords(owner(), "contacts", {
      ...parseListParams("contacts", { sort: "name" }),
      pageSize: 1,
      cursor: tampered,
    });
    expect(again.items[0]!.id).toBe(first.items[0]!.id);
    const otherShape = await listRecords(owner(), "contacts", {
      ...parseListParams("contacts", { sort: "updated" }),
      pageSize: 3,
      cursor,
    });
    expect(otherShape.items).toHaveLength(3);
  });

  it("filters by stage and tag; distinguishes empty collection from no matches", async () => {
    await saveContact(owner(), null, contact("A", { lifecycleStage: "customer", tags: ["VIP"] }));
    await saveContact(owner(), null, contact("B", { lifecycleStage: "lead" }));
    const customers = await listRecords(
      owner(),
      "contacts",
      parseListParams("contacts", { filter: "stage", value: "customer" }),
    );
    expect(customers.items.map((c) => c.firstName)).toEqual(["A"]);
    const vip = await listRecords(
      owner(),
      "contacts",
      parseListParams("contacts", { filter: "tag", value: "vip" }),
    );
    expect(vip.items.map((c) => c.firstName)).toEqual(["A"]);
    const none = await listRecords(
      owner(),
      "contacts",
      parseListParams("contacts", { filter: "stage", value: "churned" }),
    );
    expect(none).toMatchObject({ total: 0, emptyCollection: false });
    const empty = await listRecords(owner(), "leads", parseListParams("leads", {}));
    expect(empty.emptyCollection).toBe(true);
    expect(await listTags(owner())).toEqual(["vip"]);
  });
});

describe("duplicate warnings (FR-CON-003, FR-COM-003, FR-RBAC-004 AC4)", () => {
  it("reveals matches only to those who can see them", async () => {
    const { id } = await saveContact(lena(), null, contact("Lee", { email: "lee@acme.test" }));
    expect(await findDuplicateContact(manager(), " LEE@acme.test ", null)).toEqual({
      status: "visible",
      id,
      label: "Lee",
    });
    expect(await findDuplicateContact(raj(), "lee@acme.test", null)).toEqual({ status: "hidden" });
    expect(await findDuplicateContact(lena(), "lee@acme.test", id)).toEqual({ status: "none" });

    await saveCompany(owner(), null, companyInput.parse({ name: "Acme", domain: "acme.test" }));
    expect(
      await findDuplicateCompany(manager(), "https://www.ACME.test/about", null),
    ).toMatchObject({ status: "visible", label: "Acme" });
    const globex = ctxFor(uidFor("globex", "owner"), "owner", "globex");
    expect(await findDuplicateCompany(globex, "acme.test", null)).toEqual({ status: "none" });
  });
});

describe("lead conversion (FR-LEAD-002, TC-LEAD-002)", () => {
  it("creates contact, company, and deal in one transaction and relinks activities", async () => {
    const { id: leadId } = await saveLead(
      raj(),
      null,
      leadInput.parse({
        firstName: "Nina",
        lastName: "Lead",
        email: "nina@newco.test",
        companyName: "NewCo",
        estimatedValue: "5000",
      }),
    );
    await logActivity(
      raj(),
      activityInput.parse({
        type: "call",
        subject: "Intro call",
        occurredDate: "2026-10-01",
        occurredTime: "10:00",
        related: [{ type: "lead", id: leadId }],
      }),
    );
    const result = await convertLead(raj(), leadId, {
      contactId: null,
      company: { mode: "new" },
      deal: { name: "NewCo deal", amount: 500000 },
    });
    expect(result.relinkQueued).toBe(false);

    const lead = await getLead(raj(), leadId);
    const { relinkQueued: _, ...convertedTo } = result;
    expect(lead).toMatchObject({ status: "converted", convertedTo });
    const contactDoc = await getContact(raj(), result.contactId);
    expect(contactDoc).toMatchObject({
      firstName: "Nina",
      companyId: result.companyId,
      lifecycleStage: "opportunity",
      ownerUid: RAJ,
    });
    const deal = await getDeal(raj(), result.dealId!);
    expect(deal).toMatchObject({ stageId: "stg_qualification", amount: 500000, status: "open" });
    const company = await getCompany(raj(), result.companyId!);
    expect(company).toMatchObject({ name: "NewCo", counts: { contacts: 1, openDeals: 1 } });

    const contactTimeline = await listTimeline(raj(), "contact", result.contactId, null);
    expect(contactTimeline.items.map((a) => a.subject ?? a.systemEvent)).toEqual(
      expect.arrayContaining(["Intro call"]),
    );

    // Double conversion and edits of a converted lead are refused.
    await expect(
      convertLead(raj(), leadId, { contactId: null, company: { mode: "none" }, deal: null }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      saveLead(
        raj(),
        { id: leadId, expectedUpdatedAt: lead.updatedAt },
        leadInput.parse({ firstName: "x" }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("concurrent conversions: exactly one wins", async () => {
    const { id } = await saveLead(owner(), null, leadInput.parse({ firstName: "Race" }));
    const results = await Promise.allSettled([
      convertLead(owner(), id, { contactId: null, company: { mode: "none" }, deal: null }),
      convertLead(owner(), id, { contactId: null, company: { mode: "none" }, deal: null }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const contacts = await listRecords(owner(), "contacts", parseListParams("contacts", {}));
    expect(contacts.total).toBe(1);
  });

  it("Members can't convert someone else's lead", async () => {
    const { id } = await saveLead(lena(), null, leadInput.parse({ firstName: "Mine" }));
    await expect(
      convertLead(raj(), id, { contactId: null, company: { mode: "none" }, deal: null }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("deals, board, and pipeline (FR-DEAL-001..004)", () => {
  async function newDeal(ctx: TenantContext, extra: Record<string, unknown> = {}) {
    return saveDeal(
      ctx,
      null,
      dealInput.parse({ name: "Deal", stageId: "stg_qualification", amount: "100.50", ...extra }),
    );
  }

  it("moves stages with history, closes won (customer prompt), and reopens Manager+ only", async () => {
    const { id: contactId } = await saveContact(raj(), null, contact("Buyer"));
    const { id } = await newDeal(raj(), { primaryContactId: contactId });
    expect(await getDeal(raj(), id)).toMatchObject({
      amount: 10050,
      currency: "GBP",
      probability: 10,
    });

    await moveDealStage(raj(), id, "stg_proposal");
    await expect(moveDealStage(raj(), id, "stg_won")).rejects.toMatchObject({ code: "VALIDATION" });
    const board = await loadBoard(raj());
    const proposal = board.columns.find((c) => c.stage.id === "stg_proposal")!;
    expect(proposal).toMatchObject({ count: 1, sum: 10050 });

    await closeDeal(raj(), id, { outcome: "won", markContactCustomer: true });
    expect(await getDeal(raj(), id)).toMatchObject({ status: "won", stageId: "stg_won" });
    expect(await getContact(raj(), contactId)).toMatchObject({ lifecycleStage: "customer" });
    const events = (await listTimeline(raj(), "deal", id, null)).items.map((a) => a.systemEvent);
    expect(events).toEqual(["deal.won", "deal.stage_changed", "record.created"]);

    await expect(reopenDeal(raj(), id, "stg_discovery")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await reopenDeal(manager(), id, "stg_discovery");
    expect(await getDeal(raj(), id)).toMatchObject({ status: "open", stageId: "stg_discovery" });
  });

  it("board columns are own-scoped for Members", async () => {
    await newDeal(raj());
    await newDeal(lena());
    const rajBoard = await loadBoard(raj());
    expect(rajBoard.columns[0]).toMatchObject({ count: 1 });
    expect((await loadBoard(manager())).columns[0]).toMatchObject({ count: 2 });
  });

  it("pipeline edits require a target for deals in removed stages (Owner/Admin only)", async () => {
    const { id } = await newDeal(owner(), { stageId: "stg_discovery" });
    const keep = [
      { id: "stg_qualification", name: "Qualify", probability: 10 },
      { id: "stg_proposal", name: "Proposal", probability: 50 },
      { id: null, name: "Contract", probability: 90 },
    ];
    await expect(updatePipeline(manager(), keep, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updatePipeline(owner(), keep, {})).rejects.toMatchObject({ code: "VALIDATION" });
    const result = await updatePipeline(owner(), keep, {
      stg_discovery: "stg_proposal",
      stg_negotiation: "stg_proposal",
    });
    expect(result.moved).toBe(1);
    expect(await getDeal(owner(), id)).toMatchObject({ stageId: "stg_proposal", probability: 50 });
    const board = await loadBoard(owner());
    expect(board.pipeline.stages.map((s) => s.name)).toEqual([
      "Qualify",
      "Proposal",
      "Contract",
      "Won",
      "Lost",
    ]);
  });
});

describe("tasks (FR-TASK-001/002)", () => {
  it("assignee completes; completion is logged on the related record", async () => {
    const { id: contactId } = await saveContact(raj(), null, contact("Rel"));
    const { id } = await saveTask(
      raj(),
      null,
      taskInput.parse({
        title: "Call back",
        dueDate: "2026-10-12",
        related: { type: "contact", id: contactId },
      }),
    );
    const mine = await listMyTasks(raj());
    expect(mine).toEqual([
      expect.objectContaining({
        id,
        dueIsDateOnly: true,
        dueDate: "2026-10-12",
        assigneeUid: RAJ,
        related: { type: "contact", id: contactId, label: "Rel" },
      }),
    ]);
    // Europe/London is UTC+1 on 12 Oct 2026; date-only reminder at 09:00 local.
    const stored = await getById(raj(), "tasks", id);
    expect((stored.reminderAt as Timestamp).toDate().toISOString()).toBe(
      "2026-10-12T08:00:00.000Z",
    );

    await expect(setTaskDone(lena(), id, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await setTaskDone(raj(), id, true);
    expect(await listMyTasks(raj())).toEqual([]);
    const events = (await listTimeline(raj(), "contact", contactId, null)).items.map(
      (a) => a.systemEvent,
    );
    expect(events).toContain("task.completed");
  });

  it("counts overdue/today tasks for the nav badge", async () => {
    await saveTask(raj(), null, taskInput.parse({ title: "Old", dueDate: "2020-01-01" }));
    await saveTask(raj(), null, taskInput.parse({ title: "Future", dueDate: "2099-01-01" }));
    await saveTask(raj(), null, taskInput.parse({ title: "No date" }));
    expect(await myDueTaskCount(raj())).toBe(1);
  });
});

describe("activities & timeline (FR-ACT-001)", () => {
  it("orders newest first, paginates, and gates on record visibility", async () => {
    const { id } = await saveContact(raj(), null, contact("Tim"));
    for (let day = 1; day <= 22; day++) {
      await logActivity(
        raj(),
        activityInput.parse({
          type: "note",
          subject: `Note ${day}`,
          body: "<script>alert(1)</script>",
          occurredDate: `2026-09-${String(day).padStart(2, "0")}`,
          occurredTime: "09:00",
          related: [{ type: "contact", id }],
        }),
      );
    }
    // 22 back-dated notes + the "created" system entry (occurred now → newest).
    const page1 = await listTimeline(raj(), "contact", id, null);
    expect(page1.items).toHaveLength(20);
    expect(page1.items[0]!.systemEvent).toBe("record.created");
    expect(page1.items[1]!.subject).toBe("Note 22");
    const page2 = await listTimeline(raj(), "contact", id, page1.nextCursor);
    expect(page2.items.map((a) => a.subject)).toEqual(["Note 3", "Note 2", "Note 1"]);
    expect(page2.nextCursor).toBeNull();
    await expect(listTimeline(lena(), "contact", id, null)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      logActivity(
        lena(),
        activityInput.parse({
          type: "note",
          subject: "Sneaky",
          occurredDate: "2026-09-01",
          occurredTime: "09:00",
          related: [{ type: "contact", id }],
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    // Authors (or Manager+) delete logged activities; others can't.
    const target = page1.items[1]!.id;
    await expect(deleteActivity(lena(), target)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await deleteActivity(raj(), target);
    expect((await listTimeline(raj(), "contact", id, null)).items[1]!.subject).toBe("Note 21");
  });
});

describe("trash (FR-REC-001, TC-REC-001)", () => {
  it("soft delete hides, restore returns, purge removes exclusive activities and unlinks", async () => {
    const { id: companyId } = await saveCompany(
      owner(),
      null,
      companyInput.parse({ name: "Gone" }),
    );
    const { id: contactId } = await saveContact(owner(), null, contact("Linked", { companyId }));
    expect(await getCompany(owner(), companyId)).toMatchObject({ counts: { contacts: 1 } });

    await softDeleteRecord(owner(), "company", companyId);
    await expect(getCompany(owner(), companyId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listRecords(owner(), "companies", parseListParams("companies", {}))).total).toBe(
      0,
    );
    await expect(listTrash(raj(), "company", null)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listTrash(manager(), "company", null)).items).toEqual([
      expect.objectContaining({ id: companyId, label: "Gone" }),
    ]);

    await restoreRecord(manager(), "company", companyId);
    expect(await getCompany(owner(), companyId)).toMatchObject({ name: "Gone" });

    await softDeleteRecord(owner(), "company", companyId);
    await purgeRecord(manager(), "company", companyId);
    expect(
      (await getDb().doc(`tenants/${WORKSPACES.acme.id}/companies/${companyId}`).get()).exists,
    ).toBe(false);
    expect(await getContact(owner(), contactId)).toMatchObject({
      companyId: null,
      companyName: null,
    });
    const leftovers = await getDb()
      .collection(`tenants/${WORKSPACES.acme.id}/activities`)
      .where("relatedKeys", "array-contains", `company:${companyId}`)
      .get();
    expect(leftovers.empty).toBe(true);
  });

  it("scheduled purge only removes records trashed more than 30 days ago", async () => {
    const { id: oldId } = await saveContact(owner(), null, contact("Old"));
    const { id: newId } = await saveContact(owner(), null, contact("New"));
    await softDeleteRecord(owner(), "contact", oldId);
    await softDeleteRecord(owner(), "contact", newId);
    await getDb()
      .doc(`tenants/${WORKSPACES.acme.id}/contacts/${oldId}`)
      .update({ deletedAt: Timestamp.fromMillis(Date.now() - 31 * 86_400_000) });
    expect(await purgeExpiredTrash(WORKSPACES.acme.id)).toBe(1);
    expect((await listTrash(owner(), "contact", null)).items.map((i) => i.id)).toEqual([newId]);
  });

  it("Members delete only their own records and can't restore", async () => {
    const { id } = await saveContact(raj(), null, contact("Mine"));
    await softDeleteRecord(raj(), "contact", id);
    await expect(restoreRecord(raj(), "contact", id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("settings and profile (FR-SET-001/002)", () => {
  it("validates tenant settings and requires settings.manage", async () => {
    const settings = {
      timezone: "Asia/Kolkata",
      locale: "en-IN",
      currency: "INR",
      dateFormat: "DD/MM/YYYY",
      weekStart: "monday",
      fiscalYearStartMonth: 4,
    };
    await expect(updateTenantSettings(manager(), settings)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      updateTenantSettings(owner(), { ...settings, timezone: "Mars/Base" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await updateTenantSettings(owner(), settings)).changed).toEqual(
      expect.arrayContaining(["timezone", "currency"]),
    );
    const doc = await getDb().doc(`tenants/${WORKSPACES.acme.id}`).get();
    expect(doc.get("settings.currency")).toBe("INR");
  });

  it("updates the profile and member name snapshots", async () => {
    await getDb()
      .doc(`users/${RAJ}`)
      .set({ email: `${RAJ}@example.test`, tenantIds: [WORKSPACES.acme.id, "tnt_ghost"] });
    await updateProfile(raj(), { displayName: "Raj P.", timezone: "Asia/Kolkata", theme: "dark" });
    expect(await getProfile(raj())).toMatchObject({
      displayName: "Raj P.",
      timezone: "Asia/Kolkata",
      theme: "dark",
    });
    const member = await getDb().doc(`tenants/${WORKSPACES.acme.id}/members/${RAJ}`).get();
    expect(member.get("displayName")).toBe("Raj P.");
    expect((await getDb().doc(`tenants/tnt_ghost/members/${RAJ}`).get()).exists).toBe(false);
  });
});
