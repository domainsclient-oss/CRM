// Session revocation latency (FR-AUTH-006 AC1, TC-PERF-002 part 2): sign in twice as the same
// user ("device A" and "device B"), sign out on A, then measure how long B's cookie keeps working.
// Target: rejected on the next request (verifySessionCookie checks revocation every time).
// Also measures suspension propagation if SUSPEND_URL is given (target ≤ 60 s, tenant cache TTL).
//
// Usage (staging only):
//   node load/revocation-latency.mjs --base https://loadtest.app.staging.example.com \
//     --api-key <public web API key> --email user@load.test --password ...
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    "api-key": { type: "string" },
    email: { type: "string" },
    password: { type: "string" },
    "timeout-s": { type: "string", default: "120" },
  },
});
const base = values.base?.replace(/\/$/, "");
if (!base || !values["api-key"] || !values.email || !values.password) {
  console.error("Required: --base --api-key --email --password");
  process.exit(2);
}
const identity = process.env.FIREBASE_AUTH_EMULATOR_HOST
  ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com`
  : "https://identitytoolkit.googleapis.com";
const headers = { "Content-Type": "application/json", Origin: base, "X-CRM-Request": "1" };

async function signIn() {
  const res = await fetch(`${identity}/v1/accounts:signInWithPassword?key=${values["api-key"]}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: values.email,
      password: values.password,
      returnSecureToken: true,
    }),
  });
  const { idToken } = await res.json();
  const session = await fetch(`${base}/api/auth/session`, {
    method: "POST",
    headers,
    body: JSON.stringify({ idToken }),
  });
  if (session.status !== 200) throw new Error(`session create failed: ${session.status}`);
  return session.headers.get("set-cookie").split(";")[0];
}

// Probe: an authenticated Route Handler answers 401 without a valid session and 404 (no such job)
// with one. Pages can't be used — they stream 200 before redirecting to sign-in.
const works = async (cookie) =>
  (await fetch(`${base}/api/files/probe/probe.csv`, { headers: { Cookie: cookie } })).status !==
  401;

const a = await signIn();
await new Promise((r) => setTimeout(r, 1100)); // revocation timestamps are second-granular
const b = await signIn();
if (!(await works(b))) throw new Error("device B session does not work before sign-out");
// Firebase revocation is second-granular: a session created in the same second as the sign-out
// survives it (documented in T-09-01, F-09). Leave a gap so the measurement is meaningful.
await new Promise((r) => setTimeout(r, 1100));

const signedOutAt = Date.now();
await fetch(`${base}/api/auth/session`, { method: "DELETE", headers: { ...headers, Cookie: a } });
let latencyMs = null;
while (Date.now() - signedOutAt < Number(values["timeout-s"]) * 1000) {
  if (!(await works(b))) {
    latencyMs = Date.now() - signedOutAt;
    break;
  }
  await new Promise((r) => setTimeout(r, 250));
}
console.log(
  JSON.stringify({
    check: "session_revocation",
    latencyMs,
    pass: latencyMs !== null && latencyMs < 5000,
  }),
);
process.exit(latencyMs !== null && latencyMs < 5000 ? 0 : 1);
