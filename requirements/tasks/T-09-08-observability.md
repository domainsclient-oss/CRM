# T-09-08 — Observability verification (NFR-OBS-001, TC-OBS-001)

## Verified in the repo (2026-10-10)

**Log format**
- Logs are structured JSON with Cloud Logging `severity`.
- Every request-scoped line carries `requestId`. Tenant, agency and platform contexts add `tenantId`, `agencyId` and `uid` through child loggers.
- Tests: `logger.test.ts`.

**Redaction (T-09-01 F-06)**
- These keys are always redacted:
  - passwords, secrets, tokens, `authorization`, cookies, private and API keys, sessions, credentials;
  - `email`, `phone`, `ip`, `ipAddress`, `userAgent`.
- Every string value is scrubbed for emails, JWTs, Bearer/Basic credentials and PEM private keys, including error messages.
- Long strings are truncated. Errors are logged without stack traces.

**Errors returned to users** carry only a generic message and a request ID (`toActionError`). Server-side detail stays in the logs.

**Audit trail** is separate from logs: Firestore audit collections with retention per 03 §13. This was verified in Phase 6.

## Alert definitions (to wire in T-11-02, needs the GCP project)

Log-based metrics in Cloud Logging, with alerting policies routed to on-call:

| Metric (filter on `jsonPayload.message`) | Condition | Why |
|---|---|---|
| `rate_limit.store_unavailable` | any, over 5 min | Sign-ins fail closed while the store is down (T-09-01 F-01) |
| `tenant_mismatch` | any | A document's `tenantId` doesn't match its path, which suggests data corruption or an isolation bug |
| `unhandled_error` | above 5 per 5 min | Unexpected server errors (details in the log line, request ID returned to the user) |
| Platform audit `auth.privileged_login` with `newDevice=true` (Firestore audit, not a log line; export via scheduled query) | more than 5 per hour | Possible platform or agency account takeover |
| `health.firestore_unreachable` | 2 consecutive | Firestore connectivity |
| HTTP 5xx rate (Vercel log drain) | above 2 % over 5 min | Regressions |
| HTTP 429 rate on `/api/auth/session` | above 10× baseline | Credential stuffing |
| `job_failed`, `tenant_purge_incomplete`, `mail.delivery_failed`, `domain_check_failed` | any | Background jobs, outbound email, domain checks |
| Firestore `document/read_ops_count` | above 3× the 7-day hourly average | Runaway queries or polling (T-08-06 runbook) |

Dashboards: requests by status and route, p95 latency by route class (page vs mutation), job outcomes, and reads per hour.
