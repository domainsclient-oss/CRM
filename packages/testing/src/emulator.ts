// Helpers for tests that run against the Firebase Emulator Suite (requirements/09 §13).
// Refuse to touch anything that is not an emulator with a demo- project ID.

export const DEMO_PROJECT_ID = "demo-crm";

export function emulatorHost(variable: "FIRESTORE_EMULATOR_HOST" | "FIREBASE_AUTH_EMULATOR_HOST") {
  const host = process.env[variable];
  if (!host) throw new Error(`${variable} is not set — start tests with \`pnpm test:rules\``);
  return host;
}

function assertDemoProject(projectId: string) {
  if (!projectId.startsWith("demo-")) {
    throw new Error(`Refusing to clear non-demo project "${projectId}"`);
  }
}

/** Delete all Firestore documents in the emulator (REST endpoint, emulator only). */
export async function clearFirestoreEmulator(projectId = DEMO_PROJECT_ID): Promise<void> {
  assertDemoProject(projectId);
  const host = emulatorHost("FIRESTORE_EMULATOR_HOST");
  const res = await fetch(
    `http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`Failed to clear Firestore emulator: ${res.status}`);
}

/** Delete all Auth users in the emulator. */
export async function clearAuthEmulator(projectId = DEMO_PROJECT_ID): Promise<void> {
  assertDemoProject(projectId);
  const host = emulatorHost("FIREBASE_AUTH_EMULATOR_HOST");
  const res = await fetch(`http://${host}/emulator/v1/projects/${projectId}/accounts`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to clear Auth emulator: ${res.status}`);
}
