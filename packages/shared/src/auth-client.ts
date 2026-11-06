import { getApp, getApps, initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
} from "firebase/auth";
import { getPublicEnv } from "./public-env";
import type { ActionError } from "./errors";

// Browser-side sign-in (requirements/02 §4.2). The client SDK is used only to obtain a
// fresh ID token; the server exchanges it for an httpOnly session cookie. Persistence is
// in-memory and we sign out of the SDK right after, so no long-lived refresh token stays
// in browser storage (FR-AUTH-004 AC4).

let auth: Auth | undefined;

function clientAuth(): Auth {
  if (auth) return auth;
  const env = getPublicEnv();
  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
      });
  auth = getAuth(app);
  if (env.NEXT_PUBLIC_USE_AUTH_EMULATOR) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  }
  return auth;
}

export type SignInFailure =
  "invalid_credentials" | "too_many_attempts" | "popup_closed" | "network" | ActionError["code"];

export type SignInResult = { ok: true } | { ok: false; reason: SignInFailure; requestId?: string };

function firebaseFailure(error: unknown): SignInFailure {
  const code = (error as { code?: string }).code ?? "";
  if (code.includes("too-many-requests")) return "too_many_attempts";
  if (code.includes("popup-closed") || code.includes("cancelled-popup")) return "popup_closed";
  if (code.includes("network")) return "network";
  // Wrong email, wrong password, disabled user: one generic answer (no enumeration).
  return "invalid_credentials";
}

async function exchange(idToken: string): Promise<SignInResult> {
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CRM-Request": "1" },
    body: JSON.stringify({ idToken }),
    credentials: "same-origin",
  }).catch(() => null);
  if (!res) return { ok: false, reason: "network" };
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => null)) as { error?: ActionError } | null;
  return {
    ok: false,
    reason: body?.error?.code ?? "INTERNAL",
    ...(body?.error?.requestId ? { requestId: body.error.requestId } : {}),
  };
}

/** Returns a fresh ID token for the signed-in user, then clears the SDK session. */
async function withFreshToken<T>(
  signIn: (a: Auth) => Promise<{ user: { getIdToken(): Promise<string> } }>,
  use: (idToken: string) => Promise<T>,
): Promise<T | SignInResult> {
  const a = clientAuth();
  await setPersistence(a, inMemoryPersistence);
  let idToken: string;
  try {
    const cred = await signIn(a);
    idToken = await cred.user.getIdToken();
  } catch (error) {
    return { ok: false, reason: firebaseFailure(error) };
  }
  try {
    return await use(idToken);
  } finally {
    await signOut(a).catch(() => undefined);
  }
}

export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  return withFreshToken(
    (a) => signInWithEmailAndPassword(a, email, password),
    exchange,
  ) as Promise<SignInResult>;
}

export async function signInWithGoogle(): Promise<SignInResult> {
  return withFreshToken(
    (a) => signInWithPopup(a, new GoogleAuthProvider()),
    exchange,
  ) as Promise<SignInResult>;
}

/** For flows that send the token to a Server Action instead (e.g. accepting an invitation). */
export async function getFreshIdToken(
  email: string,
  password: string,
): Promise<{ ok: true; idToken: string } | { ok: false; reason: SignInFailure }> {
  const result = await withFreshToken(
    (a) => signInWithEmailAndPassword(a, email, password),
    async (idToken) => ({ ok: true as const, idToken }),
  );
  return result as { ok: true; idToken: string } | { ok: false; reason: SignInFailure };
}

export { signOutEverywhere } from "./auth-session";
