import "server-only";
import { getAdminApp, getDb } from "../firebase-admin";
import { getServerEnv } from "../server-env";

// Per-agency gateway secrets (04 §7, T27): Google Secret Manager in hosted environments (resource
// names only in Firestore), an emulator-only local store otherwise. Values are never logged,
// returned to browsers, or written to Firestore outside the emulator.

export interface SecretStore {
  /** Creates the secret if needed and adds a new version; returns the resource name. */
  put(secretId: string, value: string): Promise<string>;
  get(resourceName: string): Promise<string>;
}

const SECRET_ID = /^[A-Za-z0-9_-]{1,255}$/;

export class SecretManagerStore implements SecretStore {
  constructor(private readonly projectId: string) {}

  private async headers() {
    const credential = getAdminApp().options.credential;
    if (!credential) throw new Error("secret_manager_no_credentials");
    const { access_token } = await credential.getAccessToken();
    return { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" };
  }

  private async call(path: string, init: { method: string; body?: unknown }) {
    const res = await fetch(`https://secretmanager.googleapis.com/v1/${path}`, {
      method: init.method,
      headers: await this.headers(),
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    return {
      status: res.status,
      data: (await res.json().catch(() => ({}))) as Record<string, unknown>,
    };
  }

  async put(secretId: string, value: string): Promise<string> {
    if (!SECRET_ID.test(secretId)) throw new Error("invalid_secret_id");
    const parent = `projects/${this.projectId}`;
    const created = await this.call(`${parent}/secrets?secretId=${secretId}`, {
      method: "POST",
      body: { replication: { automatic: {} }, labels: { managed_by: "crm" } },
    });
    if (created.status !== 200 && created.status !== 409)
      throw new Error(`secret_create_${created.status}`);
    const name = `${parent}/secrets/${secretId}`;
    const version = await this.call(`${name}:addVersion`, {
      method: "POST",
      body: { payload: { data: Buffer.from(value, "utf8").toString("base64") } },
    });
    if (version.status !== 200) throw new Error(`secret_version_${version.status}`);
    return name;
  }

  async get(resourceName: string): Promise<string> {
    const res = await this.call(`${resourceName}/versions/latest:access`, { method: "GET" });
    const data = (res.data.payload as { data?: string } | undefined)?.data;
    if (res.status !== 200 || !data) throw new Error(`secret_access_${res.status}`);
    return Buffer.from(data, "base64").toString("utf8");
  }
}

/** Local development and tests only: secrets in the Firestore EMULATOR. */
export class EmulatorSecretStore implements SecretStore {
  constructor() {
    if (!getServerEnv().FIRESTORE_EMULATOR_HOST)
      throw new Error("local secrets require the emulator");
  }
  async put(secretId: string, value: string): Promise<string> {
    if (!SECRET_ID.test(secretId)) throw new Error("invalid_secret_id");
    await getDb().doc(`_localSecrets/${secretId}`).set({ value });
    return `local/${secretId}`;
  }
  async get(resourceName: string): Promise<string> {
    const id = resourceName.replace(/^local\//, "");
    const value = (await getDb().doc(`_localSecrets/${id}`).get()).get("value") as
      string | undefined;
    if (!value) throw new Error("secret_not_found");
    return value;
  }
}

let store: SecretStore | undefined;
const cache = new Map<string, { value: string; at: number }>();
const CACHE_MS = 5 * 60 * 1000;

export function getSecretStore(): SecretStore {
  if (store) return store;
  const env = getServerEnv();
  store =
    env.SECRETS_BACKEND === "secret-manager"
      ? new SecretManagerStore(env.FIREBASE_PROJECT_ID)
      : new EmulatorSecretStore();
  return store;
}

/** Test hook. */
export function setSecretStore(next: SecretStore | undefined) {
  store = next;
  cache.clear();
}

/** Cached ≤ 5 minutes per instance (02 §13). */
export async function readSecret(resourceName: string): Promise<string> {
  const hit = cache.get(resourceName);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await getSecretStore().get(resourceName);
  cache.set(resourceName, { value, at: Date.now() });
  return value;
}

export function forgetSecret(resourceName: string) {
  cache.delete(resourceName);
}
