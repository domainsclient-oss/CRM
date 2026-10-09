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
import { getServerEnv, type ServerEnv } from "./server-env";

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
    // REST transport avoids gRPC start-up cost in serverless functions (Vercel).
    globalForFirebase.__crmFirestore = initializeFirestore(getAdminApp(), { preferRest: true });
  }
  return globalForFirebase.__crmFirestore;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}
