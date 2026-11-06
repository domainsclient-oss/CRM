// Seed the Firebase emulators with the canonical test scenario (requirements/12 §5).
// Usage: pnpm emulators (in one terminal), then pnpm seed.
// Safety: refuses to run unless pointed at local emulators with a demo- project ID.
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  AGENCIES,
  PEOPLE,
  WORKSPACES,
  WORKSPACE_ROLES,
  buildAgency,
  buildContact,
  buildMember,
  buildWorkspace,
  uidFor,
  type WorkspaceKey,
} from "../packages/testing/src/fixtures";
import { DEMO_PROJECT_ID } from "../packages/testing/src/emulator";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";

for (const name of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"] as const) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[name] ?? "")) {
    throw new Error(`${name} must point at a local emulator; refusing to seed.`);
  }
}

const app = initializeApp({ projectId: DEMO_PROJECT_ID }, "seed");
const db = getFirestore(app);
const auth = getAuth(app);
const PASSWORD = "local-dev-password-123"; // emulator only

async function ensureUser(uid: string, displayName: string) {
  const email = `${uid}@example.test`;
  try {
    await auth.createUser({ uid, email, displayName, password: PASSWORD, emailVerified: true });
  } catch (error) {
    if ((error as { code?: string }).code !== "auth/uid-already-exists") throw error;
  }
}

async function main() {
  const batch = db.batch();

  for (const key of Object.keys(AGENCIES) as Array<keyof typeof AGENCIES>) {
    const agency = buildAgency(key);
    batch.set(db.doc(`agencies/${agency.id}`), agency);
    batch.set(db.doc(`agencies/${agency.id}/staff/${agency.ownerUid}`), {
      uid: agency.ownerUid,
      agencyId: agency.id,
      role: "agency_owner",
      status: "active",
    });
  }

  for (const key of Object.keys(WORKSPACES) as WorkspaceKey[]) {
    const ws = buildWorkspace(key);
    batch.set(db.doc(`tenants/${ws.id}`), ws);
    batch.set(db.doc(`tenantDomains/${ws.canonicalHost}`), {
      tenantId: ws.id,
      agencyId: ws.agencyId,
      type: "custom",
      status: "active",
      isCanonical: true,
    });
    for (const role of WORKSPACE_ROLES) {
      const uid = uidFor(key, role);
      batch.set(db.doc(`tenants/${ws.id}/members/${uid}`), buildMember(key, uid, role));
    }
  }

  // Second Member in Acme with disjoint records (own-only visibility, FR-RBAC-004).
  batch.set(
    db.doc(`tenants/${WORKSPACES.acme.id}/members/${PEOPLE.lena.uid}`),
    buildMember("acme", PEOPLE.lena.uid, "member"),
  );
  // Sam: viewer in Acme, admin in Globex (multi-membership, TC-TEN-007).
  batch.set(
    db.doc(`tenants/${WORKSPACES.acme.id}/members/${PEOPLE.sam.uid}`),
    buildMember("acme", PEOPLE.sam.uid, "viewer"),
  );
  batch.set(
    db.doc(`tenants/${WORKSPACES.globex.id}/members/${PEOPLE.sam.uid}`),
    buildMember("globex", PEOPLE.sam.uid, "admin"),
  );

  for (let i = 1; i <= 5; i++) {
    for (const [owner, prefix] of [
      [PEOPLE.raj.uid, "raj"],
      [PEOPLE.lena.uid, "lena"],
    ] as const) {
      const id = `c_${prefix}_${i}`;
      batch.set(
        db.doc(`tenants/${WORKSPACES.acme.id}/contacts/${id}`),
        buildContact("acme", id, owner, { firstName: prefix, lastName: `Customer ${i}` }),
      );
    }
  }

  batch.set(db.doc(`platformAdmins/${PEOPLE.platformAdmin.uid}`), {
    role: "superadmin",
    email: `${PEOPLE.platformAdmin.uid}@example.test`,
  });

  await batch.commit();

  const uids = new Set<string>([
    ...Object.values(PEOPLE).map((p) => p.uid),
    ...(Object.keys(WORKSPACES) as WorkspaceKey[]).flatMap((k) =>
      WORKSPACE_ROLES.map((r) => uidFor(k, r)),
    ),
  ]);
  for (const uid of uids) await ensureUser(uid, uid);

  console.log(`Seeded ${uids.size} users. Emulator-only password: ${PASSWORD}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
