import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { loadMembership } from "./contexts/tenant-context";
import { getAdminAuth, getDb } from "./firebase-admin";
import type { TenantDoc, UserDoc } from "./model";
import { queueMail, queueMailNow } from "./mail";
import { logger } from "./logger";

// Public marketing-site flows (FR-PUB-001, T-08-01): demo requests and "find your workspace".
// Both are unauthenticated, so neither reveals whether an email address has an account.

const CONTACT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

export interface ContactRequestInput {
  name: string;
  email: string;
  company: string;
  teamSize: string;
  message: string;
}

/** Stores a demo request and queues a confirmation email atomically. Contents are never logged. */
export async function submitContactRequest(
  input: ContactRequestInput,
  requestId: string,
): Promise<void> {
  const db = getDb();
  const ref = db.collection("contactRequests").doc();
  const batch = db.batch();
  batch.create(ref, {
    ...input,
    status: "new",
    createdAt: FieldValue.serverTimestamp(),
    expireAt: Timestamp.fromMillis(Date.now() + CONTACT_RETENTION_MS),
  });
  queueMail(batch, {
    template: "demo_request_confirmation",
    to: input.email,
    variables: { name: input.name },
  });
  await batch.commit();
  logger.info("marketing.contact_request", { requestId, id: ref.id });
}

/** Canonical sign-in hosts of the active workspaces this account is an active member of. */
export async function workspaceHostsForEmail(email: string): Promise<string[]> {
  const user = await getAdminAuth()
    .getUserByEmail(email)
    .catch(() => null);
  if (!user) return [];
  const userDoc = (await getDb().doc(`users/${user.uid}`).get()).data() as UserDoc | undefined;
  const hosts = await Promise.all(
    (userDoc?.tenantIds ?? []).slice(0, 50).map(async (tenantId) => {
      const [tenant, member] = await Promise.all([
        getDb().doc(`tenants/${tenantId}`).get(),
        loadMembership(tenantId, user.uid),
      ]);
      const data = tenant.data() as TenantDoc | undefined;
      return data?.status === "active" && member ? data.canonicalHost : null;
    }),
  );
  return [...new Set(hosts.filter((h): h is string => Boolean(h)))].sort();
}

/**
 * "Find your workspace" (FR-PUB-001): emails the list to the address; the caller always gets
 * the same answer, whether or not anything was sent (no account enumeration).
 */
export async function sendWorkspaceList(email: string, requestId: string): Promise<void> {
  const hosts = await workspaceHostsForEmail(email);
  if (hosts.length === 0) return;
  await queueMailNow({
    template: "workspace_finder",
    to: email,
    variables: { workspaces: hosts.map((h) => `https://${h}`).join(", ") },
  });
  logger.info("marketing.workspace_list_sent", { requestId, count: hosts.length });
}
