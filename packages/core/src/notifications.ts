import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import type { TenantContext } from "./contexts/tenant-context";
import { loadTenantDoc } from "./contexts/tenant-context";
import { NotFoundError } from "./errors";
import { getDb } from "./firebase-admin";
import { logger } from "./logger";
import { queueMailNow } from "./mail";
import type { MemberDoc } from "./model";
import { decodeCursor, encodeCursor } from "./records/cursor";
import { toPlain } from "./records/plain";
import { assertSafeId, tenantCollection } from "./repositories/base";
import { getServerEnv } from "./server-env";
import { hostUrl } from "./urls";

// Notifications (FR-NOTF-001/002, FR-LEAD-003). In-app entries live under the tenant, are
// readable only by their recipient, and expire after 90 days (TTL). Email copies follow the
// recipient's per-workspace preferences and carry a signed one-click unsubscribe link. Emails
// contain the record title only — never other record content.

export const NOTIFICATION_TYPES = [
  "record_assigned",
  "task_due",
  "invitation_accepted",
  "job_finished",
  "role_changed",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationPrefs = Record<NotificationType, { inApp: boolean; email: boolean }>;

export const DEFAULT_PREFS: NotificationPrefs = {
  record_assigned: { inApp: true, email: true },
  task_due: { inApp: true, email: true },
  invitation_accepted: { inApp: true, email: false },
  job_finished: { inApp: true, email: false },
  role_changed: { inApp: true, email: true },
};

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export function prefsOf(
  member: Pick<MemberDoc, never> & { notificationPrefs?: unknown },
): NotificationPrefs {
  const stored = (member.notificationPrefs ?? {}) as Partial<
    Record<string, Partial<{ inApp: boolean; email: boolean }>>
  >;
  return Object.fromEntries(
    NOTIFICATION_TYPES.map((type) => [
      type,
      {
        inApp:
          typeof stored[type]?.inApp === "boolean"
            ? stored[type]!.inApp!
            : DEFAULT_PREFS[type].inApp,
        email:
          typeof stored[type]?.email === "boolean"
            ? stored[type]!.email!
            : DEFAULT_PREFS[type].email,
      },
    ]),
  ) as NotificationPrefs;
}

// ---- Unsubscribe tokens (signed; no login needed for one-click unsubscribe) ----

function secret(): string {
  const configured = getServerEnv().UNSUBSCRIBE_SIGNING_SECRET;
  if (configured) return configured;
  // Local/test only (hosted environments require the secret): stable per project so links survive restarts.
  return `local-unsubscribe-${getServerEnv().FIREBASE_PROJECT_ID}`;
}

export function unsubscribeToken(tenantId: string, uid: string, type: NotificationType): string {
  const body = Buffer.from(JSON.stringify({ t: tenantId, u: uid, n: type })).toString("base64url");
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyUnsubscribeToken(
  token: string,
): { tenantId: string; uid: string; type: NotificationType } | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(createHmac("sha256", secret()).update(body).digest("base64url"));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      t: string;
      u: string;
      n: string;
    };
    if (!(NOTIFICATION_TYPES as readonly string[]).includes(p.n)) return null;
    return { tenantId: p.t, uid: p.u, type: p.n as NotificationType };
  } catch {
    return null;
  }
}

/** One-click unsubscribe from one notification type's emails (token is the proof). */
export async function unsubscribe(token: string): Promise<{ type: NotificationType }> {
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) throw new NotFoundError("bad_token");
  assertSafeId(parsed.tenantId);
  assertSafeId(parsed.uid);
  const ref = getDb().doc(`tenants/${parsed.tenantId}/members/${parsed.uid}`);
  const member = (await ref.get()).data() as
    (MemberDoc & { notificationPrefs?: unknown }) | undefined;
  if (!member) throw new NotFoundError();
  const prefs = prefsOf(member);
  prefs[parsed.type] = { ...prefs[parsed.type], email: false };
  await ref.update({ notificationPrefs: prefs });
  return { type: parsed.type };
}

// ---- Sending ----

export interface NotifyInput {
  tenantId: string;
  recipientUid: string;
  type: NotificationType;
  /** Record label or short title — no other record content (FR-NOTF-002). */
  title: string;
  /** Relative in-app path. */
  link: string;
}

/**
 * Deliver one notification according to the recipient's preferences. Called after the triggering
 * change committed; failures are logged and never undo the change.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    assertSafeId(input.tenantId);
    assertSafeId(input.recipientUid);
    const member = (
      await getDb().doc(`tenants/${input.tenantId}/members/${input.recipientUid}`).get()
    ).data() as (MemberDoc & { notificationPrefs?: unknown }) | undefined;
    if (!member || member.status !== "active") return;
    const prefs = prefsOf(member)[input.type];
    const title = input.title.slice(0, 120);
    const link = input.link.startsWith("/") ? input.link.slice(0, 300) : "/";
    if (prefs.inApp) {
      await tenantCollection({ tenantId: input.tenantId }, "notifications").add({
        tenantId: input.tenantId,
        recipientUid: input.recipientUid,
        type: input.type,
        title,
        link,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
        expireAt: Timestamp.fromMillis(Date.now() + RETENTION_MS),
      });
    }
    if (prefs.email && member.email) {
      const tenant = await loadTenantDoc(input.tenantId);
      if (!tenant) return;
      await queueMailNow({
        template: "notification",
        to: member.email,
        tenantId: input.tenantId,
        variables: {
          title,
          kind: input.type,
          link: hostUrl(tenant.canonicalHost, link),
          unsubscribe: hostUrl(
            tenant.canonicalHost,
            `/unsubscribe?t=${unsubscribeToken(input.tenantId, input.recipientUid, input.type)}`,
          ),
        },
      });
    }
  } catch (error) {
    logger.error("notify_failed", {
      type: input.type,
      error: error instanceof Error ? error.message : "x",
    });
  }
}

// ---- Reading (own notifications in the current workspace only — TC-NOTF-001) ----

const SHAPE = "notifications.mine";
const PAGE = 20;

export async function listNotifications(ctx: TenantContext, cursor: string | null) {
  let q = tenantCollection(ctx, "notifications")
    .where("recipientUid", "==", ctx.uid)
    .orderBy("createdAt", "desc")
    .orderBy(FieldPath.documentId(), "desc");
  const after = decodeCursor(SHAPE, cursor);
  if (after) q = q.startAfter(after[0], after[1]);
  const snap = await q.limit(PAGE + 1).get();
  const docs = snap.docs.slice(0, PAGE);
  const last = docs.at(-1);
  return {
    items: docs.map((d) => {
      const p = toPlain(d.data()) as Record<string, unknown>;
      return {
        id: d.id,
        type: String(p.type),
        title: String(p.title),
        link: String(p.link),
        readAt: (p.readAt as string | null) ?? null,
        createdAt: String(p.createdAt ?? ""),
      };
    }),
    nextCursor:
      snap.docs.length > PAGE && last ? encodeCursor(SHAPE, last.get("createdAt"), last.id) : null,
  };
}

export async function unreadCount(ctx: TenantContext): Promise<number> {
  const snap = await tenantCollection(ctx, "notifications")
    .where("recipientUid", "==", ctx.uid)
    .where("readAt", "==", null)
    .count()
    .get();
  return snap.data().count;
}

export async function markRead(
  ctx: TenantContext,
  id: string | "all",
): Promise<{ updated: number }> {
  if (id !== "all") {
    assertSafeId(id);
    const ref = tenantCollection(ctx, "notifications").doc(id);
    const doc = (await ref.get()).data();
    if (!doc || doc.recipientUid !== ctx.uid) throw new NotFoundError();
    if (!doc.readAt) await ref.update({ readAt: FieldValue.serverTimestamp() });
    return { updated: 1 };
  }
  const snap = await tenantCollection(ctx, "notifications")
    .where("recipientUid", "==", ctx.uid)
    .where("readAt", "==", null)
    .limit(400)
    .get();
  const batch = getDb().batch();
  for (const d of snap.docs) batch.update(d.ref, { readAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return { updated: snap.size };
}

export async function getNotificationPrefs(ctx: TenantContext): Promise<NotificationPrefs> {
  const member = (await tenantCollection(ctx, "members").doc(ctx.uid).get()).data() ?? {};
  return prefsOf(member);
}

export async function updateNotificationPrefs(ctx: TenantContext, prefs: NotificationPrefs) {
  await tenantCollection(ctx, "members")
    .doc(ctx.uid)
    .update({ notificationPrefs: prefsOf({ notificationPrefs: prefs }) });
  return { ok: true };
}
