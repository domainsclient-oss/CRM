// Seeding helpers for integration tests. Writes through the Admin SDK to the emulator.
import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { clearAuthEmulator, clearFirestoreEmulator } from "./emulator";
import {
  AGENCIES,
  WORKSPACES,
  buildAgency,
  buildContact,
  buildMember,
  buildWorkspace,
  type WorkspaceKey,
  type WorkspaceRole,
} from "./fixtures";

export const TEST_PASSWORD = "integration-test-password-1";

export async function resetEmulators(): Promise<void> {
  await Promise.all([clearFirestoreEmulator(), clearAuthEmulator()]);
}

export async function createUser(auth: Auth, uid: string, opts: { emailVerified?: boolean } = {}) {
  const email = `${uid}@example.test`;
  await auth.createUser({
    uid,
    email,
    password: TEST_PASSWORD,
    emailVerified: opts.emailVerified ?? true,
  });
  return { uid, email };
}

/** Agencies, workspaces and their active platform-subdomain host mappings. */
export async function seedTenancy(db: Firestore): Promise<void> {
  const batch = db.batch();
  for (const key of Object.keys(AGENCIES) as Array<keyof typeof AGENCIES>) {
    const { id, ...agency } = buildAgency(key);
    batch.set(db.doc(`agencies/${id}`), { ...agency, usage: { workspaces: 0, seats: 0 } });
  }
  for (const key of Object.keys(WORKSPACES) as WorkspaceKey[]) {
    const { id, ...ws } = buildWorkspace(key);
    batch.set(db.doc(`tenants/${id}`), ws);
    batch.set(db.doc(`tenantDomains/${ws.canonicalHost}`), {
      tenantId: id,
      agencyId: ws.agencyId,
      type: "custom",
      status: "active",
      isCanonical: true,
    });
  }
  await batch.commit();
}

export async function addMember(
  db: Firestore,
  workspace: WorkspaceKey,
  uid: string,
  role: WorkspaceRole,
  overrides: Record<string, unknown> = {},
) {
  const tenantId = WORKSPACES[workspace].id;
  await db
    .doc(`tenants/${tenantId}/members/${uid}`)
    .set({ ...buildMember(workspace, uid, role), ...overrides });
}

export async function addContact(
  db: Firestore,
  workspace: WorkspaceKey,
  id: string,
  ownerUid: string,
) {
  const tenantId = WORKSPACES[workspace].id;
  await db.doc(`tenants/${tenantId}/contacts/${id}`).set(buildContact(workspace, id, ownerUid));
}
