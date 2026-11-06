# T-10-01 — Staging production-parity checklist

Staging must behave like production. Anything that differs here is a risk the UAT run won't catch. Tick each item with evidence before T-10-02.

## Automated

| # | Check | Command / evidence |
|---|---|---|
| P1 | Staging and production env sets match by name, each passes hosted validation, and no secret or Firebase project is shared | `pnpm env:parity --staging <file> --production <file>` on files from `vercel env pull` (prints names only). Delete the pulled files afterwards; they are git-ignored, but don't leave secrets on disk |
| P2 | Security Rules deployed = repo (deny-all) | `firebase deploy --only firestore:rules,storage --project <staging> --dry-run` shows no diff |
| P3 | Indexes deployed = generated | `pnpm indexes:gen --check`, then `firebase firestore:indexes --project <staging>` compared with `firebase/firestore.indexes.json` |
| P4 | TTL policies present for every collection group in `scripts/ttl-policies.mjs` (incl. `contactRequests`, `tenantTombstones`) | `gcloud firestore fields ttls list --project <staging>` matches the list printed by `node scripts/ttl-policies.mjs --project <staging>` |
| P5 | Release build artifacts clean | `pnpm build && pnpm scan:bundles && pnpm sbom` on the staging commit |

## Manual

| # | Check | Expected |
|---|---|---|
| P6 | Regions | Firestore, Functions and Vercel regions match `instances/<instance>.json` for both environments |
| P7 | IAM | Same service-account roles in staging and production (least privilege, [04 §6](../04-security-and-compliance.md#6-firebase-admin-sdk-and-service-accounts)); Vercel → GCP federation in both; no keys in production |
| P8 | Domains | `www`, `console`, `partners`, the `app.` wildcard, and at least one custom domain on staging; TLS valid; HSTS present |
| P9 | Backups | PITR on and the daily backup schedule exists in staging, as in production (T-10-04 depends on it) |
| P10 | Rate limiting | Upstash database per environment (`RATE_LIMIT_BACKEND=redis`); a forced outage blocks sign-ins and lets signed-in users continue (T-09-01 F-01) |
| P11 | Email | Provider configured (Resend, OQ-06); SPF/DKIM/DMARC on the sending domain; a test invitation arrives |
| P12 | Functions | All scheduled functions deployed (reminders every 5 min, domain checks every 10 min, daily purge) and the outbox trigger fires |
| P13 | Auth | Authorized domains include staging hosts; Google provider restricted to the staff domain for the console |
| P14 | Monitoring | Uptime checks and the T-09-08 alert policies exist in staging too, routed to a test channel |
| P15 | Payments | Gateways in test mode only — **Phase 6b** |

Record the results and the date in STATUS.md (T-10-01).
