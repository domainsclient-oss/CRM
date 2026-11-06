# T-08-06 — Cost review and billing-alert runbook

- Phase: 8 · Requirements: NFR-COST-001, [03 §11](../03-database-schema.md#11-cost-optimization)
- Measured: 2026-10-10, Firestore emulator, by `packages/core/src/read-budget.int.test.ts` (runs in `pnpm test:integration`; fails if a view goes over its budget)
- Protected areas touched: none (billing alerts need the GCP project, T-01-09 — owner action)

## 1. How the numbers are measured

The test patches the Admin SDK so it counts billed reads:

- One read per returned document, and at least one per query (Firestore bills empty queries as one read).
- One read per `count()` aggregation (each one covers up to 1,000 index entries).
- Single-document `get()` is counted once, at `Firestore.getAll`, which it delegates to.

Data set: 40 contacts, 30 deals and 12 tasks in one workspace.

Views are measured warm: the host, tenant and agency documents sit in the 60 s in-process cache, as they do in steady state. A cold serverless instance adds up to 3 reads (`tenantDomains`, `tenants`, `agencies`) on its first request per host.

## 2. Reads per view against the budget

| View | Measured | Budget (03 §11) | Notes |
|------|---------:|----------------:|-------|
| Request overhead (session → membership) | 1 | 1 | Membership is read fresh on every request by design (role changes take effect immediately). |
| App shell (branding, config, usage banner, unread count, due-task badge, profile, workspace switcher) | 9 | 12 (new) | Not in 03 §11. Budgeted in the test so it can't grow silently. |
| List page, 25 rows — Owner | 27 | 27 | 26 documents (25 + 1 to detect a next page) + 1 count. |
| List page — Member (own scope) | 2 | 27 | Raj owns no contacts: one empty query + count. |
| Record detail (record + timeline) | 3 | 35 | Related sections load on demand. |
| Dashboard | 22 | 35 | Stage aggregations + KPIs + recent items. |
| Kanban board (20 cards per column) | 28 | 305 | 30 deals over the default stages. |
| Global search keystroke | 14 | 20 | 4 entities × ≤ 3 hits + the token queries. |
| Notification poll | 1 | 1 | The unread count only. The poll also goes through the action wrapper, so it pays the 1-read request overhead too. |

A typical signed-in page view therefore costs:

- **about 37 reads** for overhead + shell + a list page;
- **about 32 reads** for the dashboard (overhead + shell + 22).

## 3. Monthly estimate model

Monthly reads ≈ users × working days × (page views/day × reads per view + polls/day × 2).

Example workload: 1,000 active users, 22 working days, 150 page views a day at ~35 reads, and 8 visible hours of polling at one poll a minute (480 polls a day at 2 reads):

- Page views: 1,000 × 22 × 150 × 35 ≈ **115.5 M reads**
- Polls: 1,000 × 22 × 480 × 2 ≈ **21.1 M reads**
- Total: **≈ 137 M reads a month**, plus writes (record edits, audit entries, activities) at roughly 3–4 writes per mutation.

To get the cost, multiply by the current Firestore price per 100,000 reads (and per 100,000 writes) for the chosen location. Take the price from <https://cloud.google.com/firestore/pricing> when the project region is fixed (T-01-09); it is not hard-coded here because it changes.

## 4. Changes made in this review

- **The notification bell no longer polls from hidden tabs** (`apps/web/src/features/data/notification-bell.tsx`). It refreshes when the tab becomes visible again.
  - Before this change, a tab left open overnight cost 2 reads a minute.
  - This was the largest avoidable cost found.
- **Marketing pages make no Firestore reads.** They are statically generated at build time, and the proxy answers `robots.txt`, `sitemap.xml` and `llms.txt` without a tenant lookup.

## 5. Recommendations (not yet done)

| # | Change | Saving | Effort |
|---|--------|--------|--------|
| R1 | Read `users/{uid}` once per request instead of three times in the shell (`getProfile`, `listUserWorkspaces`, `myDueTaskCount`), using a per-request cache in the web app's server layer. | 2 reads per page view (~6%). | Small |
| R2 | Count the unread notifications from a counter on the member document (maintained by `notify`/`markRead`) instead of a `count()` query. | Same reads; the count stays at 1 read as volume grows. | Medium |
| R3 | Lengthen the poll interval to 120 s once real usage data exists (ADR-003 allows 60–120 s). | Halves poll reads. | Trivial |
| R4 | Track per-tenant reads (log `reads` per request, sampled) so abusive tenants show up (03 §11). | Detection only. | Medium |

## 6. Billing-alert runbook

Prerequisite: the GCP project and billing account exist (T-01-09, owner action). Alerts cannot be created before that.

1. **Create budgets.** Billing → Budgets & alerts → Create budget.
   - Scope: the production project only.
   - Make one budget per environment: production, and staging with its own small amount.
   - Amount: the monthly estimate from §3 plus 30%.
2. **Set alert thresholds** at 50%, 80% and 100% of actual spend, plus 100% of forecasted spend.
   - Send notifications to the billing admins and the on-call email.
   - Link a Pub/Sub topic `billing-alerts` for automation later.
3. **Watch the right metric.** Cloud Monitoring → Firestore → `document/read_ops_count`.
   - Set an alerting policy on any 1-hour window above 3× the trailing 7-day hourly average. A runaway query or a polling loop shows up here hours before the budget alert.
4. **When an alert fires:**
   1. Open Firestore usage (Query insights / Key Visualizer) and the `read_ops_count` chart to find when the jump started.
   2. Match it to a deploy: check the Vercel deployment list and the `requestId`s in the logs.
   3. If the cause is a release, roll back on Vercel (instant), then fix forward with a read-budget test that reproduces it.
   4. If the cause is one tenant, find it in the logs (`tenantId` is on every request log line).
      - Throttle it with the rate-limit policies.
      - If it is abuse, suspend it from the platform console.
   5. Record the incident and the numbers in the ops log. Update §2 and the test budgets if the baseline legitimately changed.
5. **Review quarterly.** Re-run `pnpm test:integration` to get the read table, compare it with actual billing, and adjust the budgets in §2 and the alert amounts.
