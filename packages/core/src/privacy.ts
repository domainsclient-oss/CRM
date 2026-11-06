import "server-only";
import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { toCsv } from "@crm/shared/csv";
import { audit } from "./audit";
import { authorize } from "./authz";
import type { TenantContext } from "./contexts/tenant-context";
import { clearTenantCaches } from "./contexts/tenant-context";
import { ConflictError, NotFoundError } from "./errors";
import { getAdminAuth, getDb } from "./firebase-admin";
import type { MemberDoc, UserDoc } from "./model";
import { bumpCompanyCounts, bumpUsage, relatedKey } from "./records/common";
import { toPlain } from "./records/plain";
import { OWNED_COLLECTIONS, assertSafeId, tenantCollection } from "./repositories/base";
import { assertRecentAuth, revokeAllSessions } from "./session";

// Privacy tools (FR-PRIV-001..003). DSAR export and erasure are Admin+ (privacy.manage); erasure
// needs a recent sign-in, bypasses the trash, and leaves only a hashed erasure-log entry so it can
// be re-applied after a backup restore (R-09). Account deletion is self-service.

export const ERASED = "[erased]";
const hashId = (tenantId: string, contactId: string) =>
  createHash("sha256").update(`${tenantId}:${contactId}`).digest("hex");

async function loadContact(ctx: TenantContext, contactId: string) {
  assertSafeId(contactId);
  const ref = tenantCollection(ctx, "contacts").doc(contactId);
  const data = (await ref.get()).data();
  if (!data || data.tenantId !== ctx.tenantId) throw new NotFoundError();
  return { ref, data };
}

/** FR-PRIV-001: everything linked to one contact, as JSON + CSV (audited). */
export async function exportContactData(ctx: TenantContext, contactId: string) {
  authorize(ctx, "privacy.manage");
  const { data } = await loadContact(ctx, contactId);
  const key = relatedKey({ type: "contact", id: contactId });
  const [activities, deals, tasks, lead] = await Promise.all([
    tenantCollection(ctx, "activities").where("relatedKeys", "array-contains", key).get(),
    tenantCollection(ctx, "deals").where("primaryContactId", "==", contactId).get(),
    tenantCollection(ctx, "tasks").where("related.id", "==", contactId).get(),
    data.convertedFromLeadId
      ? tenantCollection(ctx, "leads").doc(String(data.convertedFromLeadId)).get()
      : Promise.resolve(null),
  ]);
  const plain = (d: FirebaseFirestore.DocumentSnapshot) => ({
    id: d.id,
    ...(toPlain(d.data()) as object),
  });
  const bundle = {
    contact: { id: contactId, ...(toPlain(data) as object) },
    activities: activities.docs.map(plain),
    deals: deals.docs.map(plain),
    tasks: tasks.docs.map(plain),
    leadOrigin: lead?.exists ? plain(lead) : null,
  };
  const csv = toCsv([
    ["section", "id", "summary"],
    ["contact", contactId, [data.firstName, data.lastName, data.email].filter(Boolean).join(" ")],
    ...activities.docs.map((d) => [
      "activity",
      d.id,
      `${String(d.get("type"))}: ${String(d.get("subject") ?? "")}`,
    ]),
    ...deals.docs.map((d) => ["deal", d.id, String(d.get("name"))]),
    ...tasks.docs.map((d) => ["task", d.id, String(d.get("title"))]),
  ]);
  const batch = getDb().batch();
  audit(
    batch,
    { tenantId: ctx.tenantId },
    {
      action: "privacy.dsar_exported",
      actor: { type: "user", uid: ctx.uid },
      target: { type: "contact", id: contactId },
      requestId: ctx.requestId,
    },
  );
  await batch.commit();
  return { json: JSON.stringify(bundle, null, 2), csv };
}

/** FR-PRIV-002: hard-delete the contact + its activities; redact references elsewhere. */
export async function eraseContact(ctx: TenantContext, contactId: string) {
  authorize(ctx, "privacy.manage");
  assertRecentAuth(ctx.session);
  const { ref, data } = await loadContact(ctx, contactId);
  return purgeContact(ctx, ref, data, contactId, "request");
}

/**
 * Removes a contact and its exclusive data. `request`: a new erasure (logged in erasureLog so it
 * survives restores). `reapply`: re-running a logged erasure after a backup restore (R-09), which
 * must not log it again.
 */
async function purgeContact(
  ctx: Pick<TenantContext, "tenantId" | "uid" | "requestId">,
  ref: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData,
  contactId: string,
  mode: "request" | "reapply",
) {
  const key = relatedKey({ type: "contact", id: contactId });
  const db = getDb();
  // Activities: exclusive ones are deleted, shared ones lose the contact reference.
  for (;;) {
    const acts = await tenantCollection(ctx, "activities")
      .where("relatedKeys", "array-contains", key)
      .limit(400)
      .get();
    if (acts.empty) break;
    const batch = db.batch();
    for (const a of acts.docs) {
      const keys = (a.get("relatedKeys") as string[]) ?? [];
      if (keys.length <= 1) batch.delete(a.ref);
      else
        batch.update(a.ref, {
          relatedKeys: keys.filter((k) => k !== key),
          related: ((a.get("related") as Array<{ type: string; id: string }>) ?? []).filter(
            (r) => relatedKey(r) !== key,
          ),
        });
    }
    await batch.commit();
  }
  const [deals, tasks] = await Promise.all([
    tenantCollection(ctx, "deals").where("primaryContactId", "==", contactId).get(),
    tenantCollection(ctx, "tasks").where("related.id", "==", contactId).get(),
  ]);
  const batch = db.batch();
  for (const d of deals.docs)
    batch.update(d.ref, { primaryContactId: null, primaryContactName: ERASED });
  for (const t of tasks.docs) {
    if (t.get("related.type") === "contact")
      batch.update(t.ref, { related: { type: "contact", id: "erased", label: ERASED } });
  }
  batch.delete(ref);
  if (data.isDeleted !== true) {
    bumpUsage(batch as unknown as FirebaseFirestore.Transaction, ctx, "contacts", -1);
    bumpCompanyCounts(
      batch as unknown as FirebaseFirestore.Transaction,
      ctx,
      data.companyId as string | null,
      { contacts: -1 },
    );
  }
  if (mode === "request") {
    batch.create(db.collection("erasureLog").doc(), {
      tenantId: ctx.tenantId,
      contactIdHash: hashId(ctx.tenantId, contactId),
      erasedAt: FieldValue.serverTimestamp(),
    });
  }
  audit(
    batch,
    { tenantId: ctx.tenantId },
    {
      action: mode === "request" ? "privacy.contact_erased" : "privacy.erasure_reapplied",
      actor: mode === "request" ? { type: "user", uid: ctx.uid } : { type: "system" },
      // Target id is the hash, never the raw id (the contact no longer exists).
      target: { type: "contact", id: hashId(ctx.tenantId, contactId).slice(0, 32) },
      requestId: ctx.requestId,
    },
  );
  await batch.commit();
  return { ok: true };
}

/**
 * FR-PRIV-003: self-service account deletion. Blocked while the user is the Owner of any workspace;
 * owned records go to each workspace's Owner; memberships, staff records, and the Auth user go.
 */
export async function deleteAccount(ctx: TenantContext) {
  assertRecentAuth(ctx.session);
  const db = getDb();
  const user = (await db.doc(`users/${ctx.uid}`).get()).data() as UserDoc | undefined;
  const tenantIds = [...new Set([...(user?.tenantIds ?? []), ctx.tenantId])];
  const memberships = (
    await db.getAll(...tenantIds.map((t) => db.doc(`tenants/${t}/members/${ctx.uid}`)))
  )
    .filter((s) => s.exists && s.get("status") === "active")
    .map((s) => ({ ref: s.ref, tenantId: s.ref.parent.parent!.id, member: s.data() as MemberDoc }));
  if (memberships.some((m) => m.member.role === "owner")) throw new ConflictError("sole_owner");
  if ((user?.agencyIds ?? []).length > 0) throw new ConflictError("agency_staff");

  for (const { ref, tenantId } of memberships) {
    const tenant = (await db.doc(`tenants/${tenantId}`).get()).data();
    const heir = tenant?.ownerUid as string | undefined;
    if (heir) {
      for (const [collection, field] of Object.entries(OWNED_COLLECTIONS)) {
        for (;;) {
          const owned = await db
            .collection(`tenants/${tenantId}/${collection}`)
            .where(field, "==", ctx.uid)
            .limit(400)
            .get();
          if (owned.empty) break;
          const batch = db.batch();
          for (const d of owned.docs) batch.update(d.ref, { [field]: heir, ownerUid: heir });
          await batch.commit();
        }
      }
    }
    const batch = db.batch();
    batch.update(ref, {
      status: "disabled",
      removedAt: FieldValue.serverTimestamp(),
      email: ERASED,
      displayName: ERASED,
    });
    batch.set(
      db.doc(`tenants/${tenantId}/usage/current`),
      { seats: FieldValue.increment(-1) },
      { merge: true },
    );
    if (tenant?.agencyId)
      batch.update(db.doc(`agencies/${tenant.agencyId}`), {
        "usage.seats": FieldValue.increment(-1),
      });
    audit(
      batch,
      { tenantId },
      {
        action: "account.deleted",
        actor: { type: "user", uid: ctx.uid },
        target: { type: "user", id: ctx.uid },
        requestId: ctx.requestId,
      },
    );
    await batch.commit();
  }
  await revokeAllSessions(ctx.uid).catch(() => undefined);
  await db.doc(`users/${ctx.uid}`).delete();
  await getAdminAuth().deleteUser(ctx.uid);
  clearTenantCaches();
  return { ok: true };
}

export interface ReapplyResult {
  entries: number;
  tenants: number;
  erased: number;
}

/**
 * Restore drill / recovery step (03 §13, R-09): after restoring a backup taken at `since`, erase
 * again every contact whose erasure was logged after that time. The log holds only
 * sha256(tenantId:contactId), so each affected tenant's contact IDs are hashed and matched.
 * Idempotent; a dry run reports what would be erased.
 */
export async function reapplyErasures(
  since: Date,
  opts: { dryRun?: boolean; requestId?: string } = {},
): Promise<ReapplyResult> {
  const db = getDb();
  const log = await db.collection("erasureLog").where("erasedAt", ">", since).get();
  const byTenant = new Map<string, Set<string>>();
  for (const entry of log.docs) {
    const tenantId = entry.get("tenantId") as string;
    const hash = entry.get("contactIdHash") as string;
    if (!byTenant.has(tenantId)) byTenant.set(tenantId, new Set());
    byTenant.get(tenantId)!.add(hash);
  }
  let erased = 0;
  for (const [tenantId, hashes] of byTenant) {
    assertSafeId(tenantId);
    const ctx = { tenantId, uid: "system", requestId: opts.requestId ?? "restore" };
    let last: string | null = null;
    for (;;) {
      let query = tenantCollection(ctx, "contacts")
        .orderBy("__name__")
        .select("tenantId", "isDeleted", "companyId")
        .limit(500);
      if (last) query = query.startAfter(last);
      const page = await query.get();
      if (page.empty) break;
      for (const doc of page.docs) {
        if (!hashes.has(hashId(tenantId, doc.id))) continue;
        erased++;
        if (!opts.dryRun) await purgeContact(ctx, doc.ref, doc.data(), doc.id, "reapply");
      }
      last = page.docs.at(-1)!.id;
    }
  }
  return { entries: log.size, tenants: byTenant.size, erased };
}
