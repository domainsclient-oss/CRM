# Phase 6 plan — Search, reporting, notifications, data tools

Roadmap: [11 §Phase 6](../11-implementation-roadmap.md#phase-6--search-reporting-notifications-and-integrations).
Protected paths touched: `packages/core/**`, `firebase/firestore.indexes.json`, `apps/web/src/app/api/**`,
`functions/**` (new) → H3 review. Tenant purge and erasure are destructive → covered by tests and audits.

## Split

- **6a (this pass):** T-06-01..10 and T-06-14.
- **6b (payments, H10):** T-06-11..13 need Razorpay/PayPal/Stripe sandbox accounts, Secret Manager, and a
  human approval checkpoint. Started only after the owner provides test credentials and approves.

## Decisions

1. **Job bodies live in `@crm/core/jobs`** and are idempotent per chunk. Locally/tests they run inline
   right after the job document is written (`JOBS_MODE=inline`); in hosted environments a new
   `functions/` package wires the same bodies to Firestore triggers and schedules (deployed in T-01-09).
2. **Downloads go through an authenticated route** (`/api/files/{jobId}/{file}`) that streams from the
   private bucket after re-checking the requester — instead of bearer signed URLs. Files expire with the
   job (24 h) and bucket lifecycle (7 days).
3. **Search** uses the prefix tokens already written on every save (ADR-010) plus a backfill job; one
   indexed `array-contains` query per entity (≤ 5 results each), own-scoped for Members.
4. **Reports/dashboard** use count/sum aggregations only (no scans); activities-by-user uses one count
   per member × type (bounded by seats).
5. **CSV**: own RFC 4180 parser/serializer in `@crm/shared` (no dependency), formula-injection
   protection on every exported cell.

## Phase 6b plan — payments (T-06-11..13, H10)

Gateway facts verified against official docs on 2026-11-05 (Razorpay subscriptions + webhook HMAC; Stripe
`Stripe-Signature` v1 + checkout sessions, period end on subscription items; PayPal subscriptions,
`/v1/notifications/verify-webhook-signature`, cancel needs `reason`). Re-verify before going live.

- `packages/core/src/payments/`: `PaymentGateway` interface; Razorpay, Stripe, PayPal adapters over `fetch`
  (no SDK dependencies); mock gateway for local/E2E (`TEST_GATEWAY_MOCKS`, emulator only); shared contract
  suite run against per-provider fake APIs (TC-BILL-001; sandbox runs need keys).
- Secrets: `SecretStore` — Google Secret Manager REST in hosted envs, emulator-only local store otherwise.
  Firestore keeps resource names only; write-only UI; agency owner + re-auth; audited and alerted (T27).
- Webhook Route Handler `/api/webhooks/{provider}/{agencyId}`: raw body, per-agency signature, event-ID
  idempotency in `paymentEvents`, workspace mapping from our `subscriptionIndex`, state always re-fetched
  from the gateway (TC-BILL-003). Applied inline or by a Function trigger.
- Lifecycle: normalized gateway status → `billingState`; past-due grace 7 days → read-only; manual billing
  with paid-until; nightly reconciliation (drift logged + audited); daily expiry job.
- UI: workspace Settings → Billing (plan, status, next date, history, subscribe → hosted page, cancel);
  agency console Billing (gateway credentials, plan price mapping) and manual billing per workspace.
