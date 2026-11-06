import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import type { WorkspaceRole } from "@crm/shared/permissions";
import { parseCsv } from "@crm/shared/csv";
import {
  activityInput,
  contactInput,
  dealInput,
  leadInput,
  taskInput,
} from "@crm/shared/records/schemas";
import {
  AGENCIES,
  PEOPLE,
  WORKSPACES,
  buildAgency,
  uidFor,
  type WorkspaceKey,
} from "@crm/testing/fixtures";
import { addMember, createUser, resetEmulators, seedTenancy } from "@crm/testing/seed";
import { exportAudit, listAudit } from "./audit-viewer";
import type { AgencyContext } from "./contexts/agency-context";
import {
  clearTenantCaches,
  requireTenantContext,
  type TenantContext,
} from "./contexts/tenant-context";
import { getAdminAuth, getDb, getPrivateBucket } from "./firebase-admin";
import { getJobFile, listJobs, sendTaskReminders } from "./jobs";
import { requestListExport, requestTenantExport } from "./jobs/exports";
import { previewImport, startImport, storeImportUpload } from "./jobs/imports";
import { logger } from "./logger";
import { setMailProvider, type OutgoingMail } from "./mail-delivery";
import { deliverQueuedMailToConsole } from "./mail";
import type { TenantDoc } from "./model";
import {
  listNotifications,
  markRead,
  unreadCount,
  unsubscribe,
  unsubscribeToken,
  updateNotificationPrefs,
  DEFAULT_PREFS,
} from "./notifications";
import { deleteAccount, eraseContact, exportContactData } from "./privacy";
import { MemoryRateLimiter, setRateLimiter } from "./rate-limit";
import { logActivity } from "./records/activities";
import { saveContact } from "./records/contacts";
import { closeDeal, saveDeal } from "./records/deals";
import { saveLead } from "./records/leads";
import { globalSearch } from "./records/search";
import { saveTask } from "./records/tasks";
import { reassignRecord } from "./records/trash";
import { activitiesByUser, getDashboard, leadSourceConversion, wonLostByMonth } from "./reports";
import { agencyUsageReport } from "./services/agency-admin";
import { cancelTenantDeletion, purgeTenant, requestTenantDeletion } from "./tenant-deletion";

// Phase 6 services against the emulators: search, notifications, reminders, dashboard/reports,
// import/export jobs, audit viewer, privacy, account and tenant deletion, agency report.

const ACME = WORKSPACES.acme;
const OWNER = uidFor("acme", "owner");
const MANAGER = uidFor("acme", "manager");
const RAJ = PEOPLE.raj.uid;
const LENA = PEOPLE.lena.uid;
let mail: OutgoingMail[] = [];

async function ctx(
  uid: string,
  role: WorkspaceRole,
  ws: WorkspaceKey = "acme",
  authAgeSec = 0,
): Promise<TenantContext> {
  const tenant = (await getDb().doc(`tenants/${WORKSPACES[ws].id}`).get()).data() as TenantDoc;
  return {
    tenantId: WORKSPACES[ws].id,
    agencyId: WORKSPACES[ws].agencyId,
    uid,
    role,
    session: { uid, authTime: Math.floor(Date.now() / 1000) - authAgeSec } as never,
    tenant,
    requestId: "req_test",
    log: logger,
  };
}
const owner = () => ctx(OWNER, "owner");
const manager = () => ctx(MANAGER, "manager");
const raj = () => ctx(RAJ, "member");
const lena = () => ctx(LENA, "member");

beforeEach(async () => {
  await resetEmulators();
  await seedTenancy(getDb());
  for (const [uid, role] of [
    [OWNER, "owner"],
    [MANAGER, "manager"],
    [RAJ, "member"],
    [LENA, "member"],
  ] as const) {
    await addMember(getDb(), "acme", uid, role);
  }
  await getDb().doc(`tenants/${ACME.id}`).update({ ownerUid: OWNER });
  await addMember(getDb(), "globex", uidFor("globex", "owner"), "owner");
  setRateLimiter(new MemoryRateLimiter());
  clearTenantCaches();
  mail = [];
  setMailProvider({ name: "test", send: async (m) => (mail.push(m), { id: String(mail.length) }) });
});
afterEach(() => setMailProvider(undefined));

describe("global search (FR-SRCH-001, TC-SRCH-001)", () => {
  it("matches word prefixes, own-scoped, same tenant only", async () => {
    await saveContact(
      await raj(),
      null,
      contactInput.parse({ firstName: "Priyanka", lastName: "Shah", email: "p.shah@acme.test" }),
    );
    await saveContact(
      await lena(),
      null,
      contactInput.parse({ firstName: "Priya", lastName: "Menon" }),
    );
    expect(
      (await globalSearch(await manager(), "pri")).contacts.map((h) => h.label).sort(),
    ).toEqual(["Priya Menon", "Priyanka Shah"]);
    expect((await globalSearch(await raj(), "pri")).contacts.map((h) => h.label)).toEqual([
      "Priyanka Shah",
    ]);
    expect((await globalSearch(await manager(), "priy sha")).contacts.map((h) => h.label)).toEqual([
      "Priyanka Shah",
    ]);
    expect((await globalSearch(await manager(), "acme")).contacts).toHaveLength(1); // email domain word
    expect((await globalSearch(await manager(), "p")).contacts).toEqual([]); // < 2 chars
    const globex = await ctx(uidFor("globex", "owner"), "owner", "globex");
    expect((await globalSearch(globex, "pri")).contacts).toEqual([]);
  });
});

describe("notifications (FR-NOTF-001/002, TC-NOTF-001)", () => {
  it("notifies the new owner on assignment; only they can read it", async () => {
    const { id } = await saveContact(
      await manager(),
      null,
      contactInput.parse({ firstName: "Handover" }),
    );
    await reassignRecord(await manager(), "contact", id, RAJ);
    expect(await unreadCount(await raj())).toBe(1);
    const page = await listNotifications(await raj(), null);
    expect(page.items[0]).toMatchObject({
      type: "record_assigned",
      title: "Handover",
      link: `/contacts/${id}`,
    });
    expect((await listNotifications(await lena(), null)).items).toEqual([]);
    await expect(markRead(await lena(), page.items[0]!.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await markRead(await raj(), "all");
    expect(await unreadCount(await raj())).toBe(0);

    // Email copy follows preferences and carries a working unsubscribe link (title only).
    await deliverQueuedMailToConsole();
    const email = mail.find((m) => m.subject.includes("Handover"))!;
    expect(email.html).toContain("Unsubscribe");
    expect(email.text).not.toContain("@");
  });

  it("respects preferences and one-click unsubscribe", async () => {
    await updateNotificationPrefs(await raj(), {
      ...DEFAULT_PREFS,
      record_assigned: { inApp: false, email: false },
    });
    await saveContact(
      await manager(),
      null,
      contactInput.parse({ firstName: "Quiet", ownerUid: RAJ }),
    );
    expect(await unreadCount(await raj())).toBe(0);
    const token = unsubscribeToken(ACME.id, LENA, "task_due");
    await unsubscribe(token);
    const prefs = (await getDb().doc(`tenants/${ACME.id}/members/${LENA}`).get()).get(
      "notificationPrefs",
    );
    expect(prefs.task_due).toEqual({ inApp: true, email: false });
    await expect(unsubscribe(`${token.slice(0, -2)}xx`)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("task reminders are sent exactly once and re-arm when the due date changes (TC-TASK-003)", async () => {
    const { id } = await saveTask(
      await raj(),
      null,
      taskInput.parse({ title: "Call back", dueDate: "2020-01-01", dueTime: "09:00" }),
    );
    expect(await sendTaskReminders()).toBe(1);
    expect(await sendTaskReminders()).toBe(0);
    expect((await listNotifications(await raj(), null)).items[0]).toMatchObject({
      type: "task_due",
      title: "Call back",
    });
    const task = (await getDb().doc(`tenants/${ACME.id}/tasks/${id}`).get()).data()!;
    await saveTask(
      await raj(),
      { id, expectedUpdatedAt: (task.updatedAt as Timestamp).toDate().toISOString() },
      taskInput.parse({ title: "Call back", dueDate: "2020-01-02", dueTime: "09:00" }),
    );
    expect(await sendTaskReminders()).toBe(1);
  });
});

describe("dashboard and reports (FR-DASH-001/002, FR-RPT-001, TC-DASH-001, TC-RPT-001)", () => {
  it("aggregates pipeline, wins, leads and conversion with role scope", async () => {
    await saveDeal(
      await raj(),
      null,
      dealInput.parse({ name: "R1", stageId: "stg_proposal", amount: "100" }),
    );
    await saveDeal(
      await lena(),
      null,
      dealInput.parse({ name: "L1", stageId: "stg_proposal", amount: "250" }),
    );
    const { id: won } = await saveDeal(
      await raj(),
      null,
      dealInput.parse({ name: "R2", stageId: "stg_discovery", amount: "40" }),
    );
    await closeDeal(await raj(), won, { outcome: "won", markContactCustomer: false });
    await saveLead(await raj(), null, leadInput.parse({ firstName: "Lead", source: "referral" }));

    const all = await getDashboard(await manager(), { ownerUid: null });
    expect(all.pipeline!.find((s) => s.stageId === "stg_proposal")).toMatchObject({
      count: 2,
      sum: 35000,
    });
    expect(all.wonThisMonth).toEqual({ count: 1, sum: 4000 });
    expect(all.newLeadsThisMonth).toBe(1);
    expect(all.conversion).toEqual({ converted: 0, total: 1, rate: 0 });

    const mine = await getDashboard(await lena(), { ownerUid: RAJ }); // owner filter ignored for Members
    expect(mine.pipeline!.find((s) => s.stageId === "stg_proposal")).toMatchObject({
      count: 1,
      sum: 25000,
    });
    expect(mine.wonThisMonth).toEqual({ count: 0, sum: 0 });
    const filtered = await getDashboard(await manager(), { ownerUid: RAJ });
    expect(filtered.pipeline!.find((s) => s.stageId === "stg_proposal")).toMatchObject({
      count: 1,
    });

    const months = await wonLostByMonth(await manager(), { ownerUid: null });
    expect(months).toHaveLength(12);
    expect(months.at(-1)).toMatchObject({ won: 1, wonValue: 4000, lost: 0 });

    const today = new Date().toISOString().slice(0, 10);
    const sources = await leadSourceConversion(
      await manager(),
      { ownerUid: null },
      { from: "2026-01-01", to: today },
    );
    expect(sources.find((s) => s.source === "referral")).toMatchObject({ leads: 1, converted: 0 });
    await expect(
      leadSourceConversion(await manager(), { ownerUid: null }, { from: "2020-01-01", to: today }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("counts activities by user and type; Members see only themselves", async () => {
    const { id } = await saveContact(await raj(), null, contactInput.parse({ firstName: "A" }));
    const today = new Date().toISOString().slice(0, 10);
    await logActivity(
      await raj(),
      activityInput.parse({
        type: "call",
        subject: "c",
        occurredDate: today,
        occurredTime: "00:01",
        related: [{ type: "contact", id }],
      }),
    );
    const members = [
      { uid: RAJ, name: "Raj" },
      { uid: LENA, name: "Lena" },
    ];
    const range = { from: today.slice(0, 8) + "01", to: today };
    expect(await activitiesByUser(await manager(), range, members)).toEqual([
      { uid: RAJ, name: "Raj", call: 1, meeting: 0, email: 0, note: 0 },
      { uid: LENA, name: "Lena", call: 0, meeting: 0, email: 0, note: 0 },
    ]);
    expect((await activitiesByUser(await lena(), range, members)).map((r) => r.uid)).toEqual([
      LENA,
    ]);
  });
});

describe("import and export jobs (FR-IMP-001/002, TC-IMP-001/002, TC-TEN-006)", () => {
  const csv = (text: string) => new TextEncoder().encode(text);

  it("imports valid rows, skips duplicates and bad rows, and reports errors", async () => {
    await saveContact(
      await raj(),
      null,
      contactInput.parse({ firstName: "Existing", email: "dup@acme.test" }),
    );
    const file = csv(
      "First Name;Last Name;Email;Tags\nAnn;Lee;ann@acme.test;vip,new\n;NoFirst;x@acme.test;\nDup;Row;dup@acme.test;\nBob;;not-an-email;\n",
    );
    await expect(storeImportUpload(await raj(), file)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const upload = await storeImportUpload(await manager(), file);
    expect(upload).toMatchObject({
      header: ["First Name", "Last Name", "Email", "Tags"],
      rowCount: 4,
    });
    const preview = await previewImport(await manager(), upload.uploadId, "contacts", null);
    expect(preview.mapping).toEqual(["firstName", "lastName", "email", "tags"]);
    expect(preview.errorCount).toBe(2);
    // Someone else can't continue Raj's upload.
    await expect(
      previewImport(await owner(), upload.uploadId, "contacts", null),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const { jobId } = await startImport(await manager(), {
      uploadId: upload.uploadId,
      entity: "contacts",
      mapping: preview.mapping,
      duplicateMode: "skip",
    });
    const job = (await listJobs(await manager())).find((j) => j.id === jobId)!;
    expect(job).toMatchObject({
      status: "partial",
      progress: { total: 4, processed: 4, failed: 3 },
    });
    const errorsFile = await getJobFile(await manager(), jobId, "errors.csv");
    const [body] = await getPrivateBucket().file(errorsFile.path).download();
    expect(parseCsv(body.toString("utf8")).rows.map((r) => r[0])).toEqual(["3", "4", "5"]);
    const ann = (
      await getDb()
        .collection(`tenants/${ACME.id}/contacts`)
        .where("emailNormalized", "==", "ann@acme.test")
        .get()
    ).docs[0]!;
    expect(ann.data()).toMatchObject({ ownerUid: MANAGER, tags: ["vip", "new"] });
    await expect(getJobFile(await lena(), jobId, "errors.csv")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await listNotifications(await manager(), null)).items[0]).toMatchObject({
      type: "job_finished",
    });
  });

  it("refuses imports that would exceed the record limit", async () => {
    await getDb()
      .doc(`tenants/${ACME.id}`)
      .update({ entitlementOverrides: { records: 1 } });
    clearTenantCaches();
    const upload = await storeImportUpload(await owner(), csv("firstName\nA\nB\n"));
    await expect(
      startImport(await owner(), {
        uploadId: upload.uploadId,
        entity: "contacts",
        mapping: ["firstName"],
        duplicateMode: "create",
      }),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT_EXCEEDED" });
  });

  it("exports the filtered list as CSV with formula protection; Members can't export", async () => {
    await saveContact(
      await owner(),
      null,
      contactInput.parse({ firstName: "=HYPERLINK(1)", lifecycleStage: "customer" }),
    );
    await saveContact(
      await owner(),
      null,
      contactInput.parse({ firstName: "Lead person", lifecycleStage: "lead" }),
    );
    await expect(requestListExport(await raj(), "contacts", {})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { jobId } = await requestListExport(await manager(), "contacts", {
      filter: "stage",
      value: "customer",
    });
    const file = await getJobFile(await manager(), jobId, "contacts.csv");
    const [body] = await getPrivateBucket().file(file.path).download();
    const parsed = parseCsv(body.toString("utf8"));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]![1]).toBe("'=HYPERLINK(1)");
    const audits = await getDb()
      .collection(`tenants/${ACME.id}/auditLogs`)
      .where("action", "==", "export.requested")
      .get();
    expect(audits.docs[0]!.get("meta")).toMatchObject({
      entity: "contacts",
      filter: "stage=customer",
    });
  });

  it("full tenant export contains only this tenant's data", async () => {
    await saveContact(await owner(), null, contactInput.parse({ firstName: "Mine" }));
    const globex = await ctx(uidFor("globex", "owner"), "owner", "globex");
    await saveContact(globex, null, contactInput.parse({ firstName: "Theirs" }));
    await expect(requestTenantExport(await manager())).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { jobId } = await requestTenantExport(await owner());
    const file = await getJobFile(await owner(), jobId, "workspace.jsonl");
    const [body] = await getPrivateBucket().file(file.path).download();
    const text = body.toString("utf8");
    expect(text).toContain("Mine");
    expect(text).not.toContain("Theirs");
    expect(text).not.toContain(WORKSPACES.globex.id);
  });
});

describe("audit viewer (FR-AUD-002, TC-AUD-002)", () => {
  it("filters by action or actor and exports when the plan allows", async () => {
    await saveContact(await raj(), null, contactInput.parse({ firstName: "A" }));
    await saveContact(await manager(), null, contactInput.parse({ firstName: "B" }));
    const byRaj = await listAudit(
      await owner(),
      { action: null, actorUid: RAJ, from: null, to: null },
      null,
    );
    expect(byRaj.rows.every((r) => r.actorUid === RAJ)).toBe(true);
    const created = await listAudit(
      await owner(),
      { action: "record.created", actorUid: null, from: null, to: null },
      null,
    );
    expect(created.rows).toHaveLength(2);
    await expect(
      listAudit(await manager(), { action: null, actorUid: null, from: null, to: null }, null),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      listAudit(
        await owner(),
        { action: "record.created", actorUid: RAJ, from: null, to: null },
        null,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const csvText = await exportAudit(await owner(), {
      action: "record.created",
      actorUid: null,
      from: null,
      to: null,
    });
    expect(parseCsv(csvText).rows).toHaveLength(2); // fixture plan "growth" has auditExport
  });
});

describe("privacy (FR-PRIV-001..003, TC-PRIV-001..003)", () => {
  it("exports and erases a contact", async () => {
    const { id } = await saveContact(
      await owner(),
      null,
      contactInput.parse({ firstName: "Data", lastName: "Subject" }),
    );
    await logActivity(
      await owner(),
      activityInput.parse({
        type: "note",
        subject: "note",
        occurredDate: "2026-09-01",
        occurredTime: "10:00",
        related: [{ type: "contact", id }],
      }),
    );
    await saveDeal(
      await owner(),
      null,
      dealInput.parse({ name: "D", stageId: "stg_proposal", primaryContactId: id }),
    );
    const dsar = await exportContactData(await owner(), id);
    expect(JSON.parse(dsar.json)).toMatchObject({
      contact: { firstName: "Data" },
      deals: [{ name: "D" }],
    });
    expect(JSON.parse(dsar.json).activities.length).toBeGreaterThanOrEqual(2);

    await expect(eraseContact(await manager(), id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(eraseContact(await ctx(OWNER, "owner", "acme", 3600), id)).rejects.toMatchObject({
      code: "REAUTH_REQUIRED",
    });
    await eraseContact(await owner(), id);
    expect((await getDb().doc(`tenants/${ACME.id}/contacts/${id}`).get()).exists).toBe(false);
    const acts = await getDb()
      .collection(`tenants/${ACME.id}/activities`)
      .where("relatedKeys", "array-contains", `contact:${id}`)
      .get();
    expect(acts.empty).toBe(true);
    const deal = (await getDb().collection(`tenants/${ACME.id}/deals`).get()).docs[0]!.data();
    expect(deal).toMatchObject({ primaryContactId: null, primaryContactName: "[erased]" });
    const log = (await getDb().collection("erasureLog").get()).docs[0]!.data();
    expect(log.contactIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(log)).not.toContain(id);
  });

  it("deletes a member's account, handing records to the owner; owners are blocked", async () => {
    await createUser(getAdminAuth(), RAJ);
    await getDb()
      .doc(`users/${RAJ}`)
      .set({ email: `${RAJ}@example.test`, tenantIds: [ACME.id] });
    const { id } = await saveContact(await raj(), null, contactInput.parse({ firstName: "Kept" }));
    await expect(deleteAccount(await owner())).rejects.toMatchObject({ code: "CONFLICT" });
    await deleteAccount(await raj());
    expect((await getDb().doc(`tenants/${ACME.id}/contacts/${id}`).get()).get("ownerUid")).toBe(
      OWNER,
    );
    expect((await getDb().doc(`tenants/${ACME.id}/members/${RAJ}`).get()).get("status")).toBe(
      "disabled",
    );
    await expect(getAdminAuth().getUser(RAJ)).rejects.toBeDefined();
  });
});

describe("tenant deletion (FR-TEN-006, TC-TEN-005)", () => {
  it("requests with slug confirmation, blocks members, cancels, and purges after the grace period", async () => {
    await expect(requestTenantDeletion(await owner(), "wrong")).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(requestTenantDeletion(await manager(), ACME.slug)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await requestTenantDeletion(await owner(), ACME.slug);
    clearTenantCaches();
    expect((await getDb().doc(`tenants/${ACME.id}`).get()).get("status")).toBe("pending_deletion");
    await cancelTenantDeletion(await owner());
    expect((await getDb().doc(`tenants/${ACME.id}`).get()).get("status")).toBe("active");

    await saveContact(await owner(), null, contactInput.parse({ firstName: "Gone soon" }));
    await getDb()
      .doc(`users/${RAJ}`)
      .set({ tenantIds: [ACME.id, "tnt_other"] });
    await requestTenantDeletion(await owner(), ACME.slug);
    expect(await purgeTenant(ACME.id)).toBe(false); // not due yet
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(await purgeTenant(ACME.id, later)).toBe(true);
    expect((await getDb().doc(`tenants/${ACME.id}`).get()).exists).toBe(false);
    expect((await getDb().collection(`tenants/${ACME.id}/contacts`).limit(1).get()).empty).toBe(
      true,
    );
    expect((await getDb().doc(`tenantDomains/${ACME.canonicalHost}`).get()).exists).toBe(false);
    expect((await getDb().doc(`tenantSlugs/${ACME.slug}`).get()).get("status")).toBe("quarantined");
    expect((await getDb().doc(`tenantTombstones/${ACME.id}`).get()).exists).toBe(true);
    expect((await getDb().doc(`users/${RAJ}`).get()).get("tenantIds")).toEqual(["tnt_other"]);
    // Other tenants untouched.
    expect((await getDb().doc(`tenants/${WORKSPACES.globex.id}`).get()).exists).toBe(true);
  });
});

describe("agency usage report (FR-AGY-006, TC-AGY-006)", () => {
  it("lists only the agency's workspaces with counts", async () => {
    const agencyCtx: AgencyContext = {
      agencyId: AGENCIES.agencyOne.id,
      uid: AGENCIES.agencyOne.ownerUid,
      role: "agency_owner",
      session: {} as never,
      agency: buildAgency("agencyOne") as never,
      requestId: "r",
      log: logger,
    };
    await getDb().doc(`tenants/${ACME.id}/members/${RAJ}`).update({ lastSeenAt: Timestamp.now() });
    const rows = await agencyUsageReport(agencyCtx);
    expect(rows.map((r) => r.id).sort()).toEqual([ACME.id, WORKSPACES.globex.id].sort());
    expect(rows.find((r) => r.id === ACME.id)).toMatchObject({
      activeUsers30d: 1,
      planId: "growth",
    });
  });
});

void requireTenantContext;
