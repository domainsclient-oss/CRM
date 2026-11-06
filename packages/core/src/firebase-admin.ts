import "server-only";
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
  type Credential,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { initializeFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getServerEnv, type ServerEnv } from "./server-env";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

// Admin SDK bypasses Firestore Security Rules: only server code may import this
// module (enforced by "server-only"). See requirements/02 §5 and 04 §6.

const APP_NAME = "crm-admin";

// Survives dev hot-reloads so Firestore is initialized exactly once per process.
const globalForFirebase = globalThis as typeof globalThis & {
  __crmFirestore?: Firestore;
};

function credentialFor(env: ServerEnv): Credential | undefined {
  // Emulator: the Admin SDK needs no credentials, only a project ID.
  if (env.FIRESTORE_EMULATOR_HOST) return undefined;

  // Explicit service-account key (local development / approved fallback, ADR-007).
  if (env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    return cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      // .env files store the key with escaped newlines.
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    });
  }

  // Application Default Credentials: `gcloud auth application-default login`
  // locally, or workload identity federation when hosted.
  return applicationDefault();
}

export function getAdminApp(): App {
  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) return existing;

  const env = getServerEnv();
  const credential = credentialFor(env);
  return initializeApp(
    { projectId: env.FIREBASE_PROJECT_ID, ...(credential ? { credential } : {}) },
    APP_NAME,
  );
}

export function getDb(): Firestore {
  if (!globalForFirebase.__crmFirestore) {
    // REST transport avoids gRPC start-up cost in serverless functions (Vercel), but it
    // ignores FIRESTORE_EMULATOR_HOST and looks for cloud credentials — so the
    // emulator uses the default transport.
    const env = getServerEnv();
    const useEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST);
    globalForFirebase.__crmFirestore = initializeFirestore(
      getAdminApp(),
      useEmulator ? {} : { preferRest: true },
      env.FIRESTORE_DATABASE_ID,
    );
  }
  return globalForFirebase.__crmFirestore;
}

const namedDbs = new Map<string, Firestore>();

/** Another database of the same project (restore drills compare a restored copy with the source). */
export function getNamedDb(databaseId: string): Firestore {
  if (databaseId === getServerEnv().FIRESTORE_DATABASE_ID) return getDb();
  let db = namedDbs.get(databaseId);
  if (!db) {
    db = initializeFirestore(getAdminApp(), {}, databaseId);
    namedDbs.set(databaseId, db);
  }
  return db;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

/** Brand-assets bucket (logos, favicons). The storage emulator is used when configured. */
export function getBrandBucket(): Bucket {
  const env = getServerEnv();
  return getStorage(getAdminApp()).bucket(
    env.FIREBASE_STORAGE_BRAND_BUCKET ?? `${env.FIREBASE_PROJECT_ID}-brand-assets`,
  );
}

/** Private bucket (imports, exports). Objects are only ever served through authenticated routes. */
export function getPrivateBucket(): Bucket {
  const env = getServerEnv();
  return getStorage(getAdminApp()).bucket(
    env.FIREBASE_STORAGE_PRIVATE_BUCKET ?? `${env.FIREBASE_PROJECT_ID}-private`,
  );
}
