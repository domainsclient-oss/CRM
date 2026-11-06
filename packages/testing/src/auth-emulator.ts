// Sign-in helpers against the Firebase Auth emulator (REST API), producing real ID tokens
// for integration tests. Emulator only — refuses to run without FIREBASE_AUTH_EMULATOR_HOST.
import { emulatorHost } from "./emulator";

const API_KEY = "demo-api-key";

async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const host = emulatorHost("FIREBASE_AUTH_EMULATOR_HOST");
  const res = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/${path}?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok)
    throw new Error(`Auth emulator ${path} failed: ${json.error?.message ?? res.status}`);
  return json;
}

/** Email/password sign-in → fresh ID token. */
export async function signInWithPassword(email: string, password: string): Promise<string> {
  const { idToken } = await call<{ idToken: string }>("accounts:signInWithPassword", {
    email,
    password,
    returnSecureToken: true,
  });
  return idToken;
}

/** Simulated Google sign-in (the emulator accepts an unsigned JSON id_token). */
export async function signInWithGoogle(user: {
  sub: string;
  email: string;
  emailVerified?: boolean;
}): Promise<{ idToken: string; uid: string }> {
  const idTokenClaims = JSON.stringify({
    sub: user.sub,
    email: user.email,
    email_verified: user.emailVerified ?? true,
  });
  const result = await call<{ idToken: string; localId: string }>("accounts:signInWithIdp", {
    postBody: `id_token=${encodeURIComponent(idTokenClaims)}&providerId=google.com`,
    requestUri: "http://localhost",
    returnSecureToken: true,
    returnIdpCredential: true,
  });
  return { idToken: result.idToken, uid: result.localId };
}
