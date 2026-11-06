// Session calls that don't need the Firebase client SDK. Kept apart from ./auth-client so the
// signed-in shell (sign-out button) doesn't ship the SDK and env schema (TC-PERF-001).

/** Sign out everywhere (server revokes refresh tokens) and clear the cookie. */
export async function signOutEverywhere(): Promise<void> {
  await fetch("/api/auth/session", {
    method: "DELETE",
    headers: { "X-CRM-Request": "1" },
    credentials: "same-origin",
  }).catch(() => undefined);
}
