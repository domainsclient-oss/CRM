# Load and latency checks (T-09-06, TC-PERF-002)

Run against **staging** only, on a dedicated load-test workspace. Never against production.

## Setup

1. On staging, create a workspace `loadtest` and 20 test users (Member and Manager roles), each
   owning ~50 contacts. Put their credentials in `load/users.json` (git-ignored):
   `[{ "email": "...", "password": "...", "contactIds": ["..."] }]`.
2. Export the Server Action IDs of the **deployed** build:
   `pnpm --filter web build && node scripts/k6-actions.mjs > load/actions.json` (same commit).
3. Install k6 (<https://k6.io/docs/get-started/installation/>).

## Run

```bash
# 200 VUs, 15 min steady state, mixed read/write (A-06); fails on threshold misses.
k6 run -e BASE=https://loadtest.<staging base domain> -e API_KEY=<public web API key> load/k6-mixed.js

# Sign-out-everywhere latency (target: next request rejected; measured 39 ms locally).
node load/revocation-latency.mjs --base https://loadtest.<staging base domain> \
  --api-key <public web API key> --email <test user> --password <password>
```

Thresholds (NFR-PERF-002): page p95 ≤ 800 ms, mutation p95 ≤ 500 ms, error rate < 1 %.
Sign-in is rate limited per IP; `setup()` creates one session per user before the ramp.
Record results (k6 summary + Firestore read/write counts for the window) in the task card.
