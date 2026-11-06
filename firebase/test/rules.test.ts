import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { getBytes, ref, uploadString } from "firebase/storage";
import { afterAll, beforeAll, describe, it } from "vitest";
import { DEMO_PROJECT_ID, emulatorHost } from "@crm/testing/emulator";
import { PEOPLE, SAMPLE_PATHS, WORKSPACES } from "@crm/testing/fixtures";

// TC-SEC-003 / TC-AUD-003: the browser SDK has no access to any data (ADR-003).
// Runs only inside `firebase emulators:exec` (pnpm test:rules).

const rulesPath = (file: string) => fileURLToPath(new URL(`../${file}`, import.meta.url));
const [fsHost, fsPort] = emulatorHost("FIRESTORE_EMULATOR_HOST").split(":");
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST?.split(":");

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: DEMO_PROJECT_ID,
    firestore: {
      rules: readFileSync(rulesPath("firestore.rules"), "utf8"),
      host: fsHost!,
      port: Number(fsPort),
    },
    ...(storageHost
      ? {
          storage: {
            rules: readFileSync(rulesPath("storage.rules"), "utf8"),
            host: storageHost[0]!,
            port: Number(storageHost[1]),
          },
        }
      : {}),
  });
  // Seed with rules disabled so reads target existing documents.
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const path of SAMPLE_PATHS) await setDoc(doc(ctx.firestore(), path), { seeded: true });
  });
});

afterAll(async () => {
  await env?.cleanup();
});

const contexts = () => ({
  unauthenticated: env.unauthenticatedContext(),
  member: env.authenticatedContext(PEOPLE.raj.uid, { email_verified: true }),
  // Forged custom claims must not grant anything.
  forgedClaims: env.authenticatedContext("u_attacker", {
    tenantId: WORKSPACES.acme.id,
    role: "owner",
    admin: true,
    platformAdmin: true,
  } as Record<string, unknown>),
});

describe("Firestore rules deny all client access", () => {
  for (const [label, getCtx] of Object.entries({
    unauthenticated: () => contexts().unauthenticated,
    "authenticated member": () => contexts().member,
    "forged claims": () => contexts().forgedClaims,
  })) {
    describe(label, () => {
      it.each(SAMPLE_PATHS)("cannot read, create, update, or delete %s", async (path) => {
        const db = getCtx().firestore();
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, `${path}_new`), { x: 1 }));
        await assertFails(updateDoc(doc(db, path), { x: 1 }));
        await assertFails(deleteDoc(doc(db, path)));
      });
    });
  }
});

describe.skipIf(!storageHost)("Storage rules deny all client access", () => {
  it.each(["brand/agy_one/logo.webp", "imports/tnt_acme/job.csv", "exports/tnt_acme/export.zip"])(
    "cannot read or write %s",
    async (path) => {
      for (const ctx of Object.values(contexts())) {
        await assertFails(uploadString(ref(ctx.storage(), path), "x"));
        await assertFails(getBytes(ref(ctx.storage(), path)));
      }
    },
  );
});
