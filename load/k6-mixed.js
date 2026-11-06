// k6 load test at A-06 target load (TC-PERF-002, NFR-PERF-002): 200 concurrent users, mixed
// read/write, 15 minutes, against STAGING only. Never point this at production.
//
// p95 targets: pages (list/detail/dashboard) ≤ 800 ms, mutations ≤ 500 ms, errors < 1 %.
//
// Prerequisites (load/README.md):
//   - a load-test workspace on staging with test users (load/users.json, git-ignored)
//   - action IDs from the deployed build: node scripts/k6-actions.mjs > load/actions.json
// Run:
//   k6 run -e BASE=https://loadtest.app.staging.example.com -e API_KEY=<public web API key> \
//     load/k6-mixed.js
import http from "k6/http";
import { check, group, sleep } from "k6";
import { SharedArray } from "k6/data";
import exec from "k6/execution";

const BASE = __ENV.BASE;
const API_KEY = __ENV.API_KEY;
if (!BASE || !API_KEY) throw new Error("Set BASE and API_KEY");
if (/\bprod|production\b/i.test(BASE) && __ENV.I_KNOW_THIS_IS_NOT_PROD !== "1") {
  throw new Error("Refusing to run against what looks like production");
}
const ORIGIN = BASE.replace(/\/$/, "");
const users = new SharedArray("users", () => JSON.parse(open("./users.json")));
const ACTIONS = JSON.parse(open("./actions.json"));

export const options = {
  scenarios: {
    mixed: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 200 },
        { duration: "15m", target: 200 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    "http_req_duration{kind:page}": ["p(95)<800"],
    "http_req_duration{kind:mutation}": ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
  },
};

// One session per test user, created once (sign-in is rate limited by design).
export function setup() {
  return users.map((u) => {
    const signIn = http.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
      JSON.stringify({ email: u.email, password: u.password, returnSecureToken: true }),
      { headers: { "Content-Type": "application/json" } },
    );
    const idToken = signIn.json("idToken");
    const res = http.post(`${ORIGIN}/api/auth/session`, JSON.stringify({ idToken }), {
      headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-CRM-Request": "1" },
    });
    check(res, { "session created": (r) => r.status === 200 });
    const cookie = res.headers["Set-Cookie"].split(";")[0];
    return { cookie, contactIds: u.contactIds ?? [] };
  });
}

function page(path, cookie) {
  const res = http.get(`${ORIGIN}${path}`, {
    headers: { Cookie: cookie },
    tags: { kind: "page", name: path.replace(/\/[A-Za-z0-9_-]{8,}$/, "/:id") },
    redirects: 0,
  });
  check(res, { [`GET ${path.split("/")[1] || "dashboard"} 200`]: (r) => r.status === 200 });
}

function action(name, path, input, cookie) {
  const res = http.post(`${ORIGIN}${path}`, JSON.stringify([input]), {
    headers: {
      Cookie: cookie,
      Origin: ORIGIN,
      Accept: "text/x-component",
      "Content-Type": "text/plain;charset=UTF-8",
      "Next-Action": ACTIONS[name],
    },
    tags: { kind: "mutation", name },
  });
  check(res, {
    [`${name} ok`]: (r) => r.status === 200 && !r.body.includes('"ok":false'),
  });
}

export default function (sessions) {
  const s = sessions[exec.vu.idInTest % sessions.length];
  const roll = Math.random();
  if (roll < 0.25) group("dashboard", () => page("/", s.cookie));
  else if (roll < 0.5) group("list", () => page("/contacts", s.cookie));
  else if (roll < 0.65 && s.contactIds.length > 0) {
    const id = s.contactIds[Math.floor(Math.random() * s.contactIds.length)];
    group("detail", () => page(`/contacts/${id}`, s.cookie));
  } else if (roll < 0.75) group("board", () => page("/pipeline", s.cookie));
  else if (roll < 0.85) {
    group("search", () =>
      action(
        "searchAction",
        "/",
        { q: ["dan", "acme", "lead", "deal"][Math.floor(Math.random() * 4)] },
        s.cookie,
      ),
    );
  } else if (roll < 0.95) {
    group("create contact", () =>
      action(
        "saveContactAction",
        "/contacts/new",
        {
          id: null,
          expectedUpdatedAt: null,
          values: {
            firstName: `Load${exec.vu.idInTest}`,
            lastName: `T${exec.scenario.iterationInTest}`,
            email: `load-${exec.vu.idInTest}-${exec.scenario.iterationInTest}@load.test`,
            tags: ["loadtest"],
          },
        },
        s.cookie,
      ),
    );
  } else {
    group("notifications", () => action("unreadCountAction", "/", {}, s.cookie));
  }
  sleep(1 + Math.random() * 2); // think time
}
