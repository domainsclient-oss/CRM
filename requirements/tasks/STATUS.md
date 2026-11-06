# Task board

Updated: 2026-10-10 · Process: [08 §10](../08-ai-agentic-development-workflow.md#10-task-tracking) · Roadmap: [11](../11-implementation-roadmap.md)

Status values: `Ready · Planning · PlanReview · Implementing · Review · HumanApproval · Done · Blocked`

## Phase 0 — Requirements validation
| Task | Title | Status | Notes |
|------|-------|--------|-------|
| T-00-01 | Answer open questions | Implementing | 8 answered (v1.1); OQ-19..25 still open |
| T-00-02 | Approve ADRs | Ready | Owner approval pending |
| T-00-03 | Freeze MVP scope | Ready | |
| T-00-04 | Vendors & domains | Ready | |
| T-00-05 | Compliance kickoff | Ready | |

## Phase 1 — Foundation and tooling
| Task | Title | Status | Evidence / notes |
|------|-------|--------|------------------|
| T-01-01 | Monorepo, Next.js apps, strict TS, ESLint boundaries, Prettier | Review | `apps/web`, `apps/console`, `packages/{core,shared,ui,testing}`; boundary rules proven on a probe file; proxy.ts verified |
| T-01-02 | Vitest + RTL + axe | Review | 53 tests pass (`pnpm test`) |
| T-01-03 | Playwright | Review | 14/14 smoke on chromium-desktop + android; other browsers configured |
| T-01-04 | Emulators, fixtures, rules harness, seed | Review | Portable JDK 21 in `.tools/` (git-ignored, checksum-verified); `pnpm test:rules` 120 pass; `pnpm seed` works |
| T-01-05 | CI, CODEOWNERS, Dependabot, CodeQL | Review | Workflows written; need GitHub repo + branch protection (T-01-09 #4). Prod audit clean |
| T-01-06 | Env validation | Review | `@crm/core/server-env` (hosted-env safety rules), `@crm/shared/public-env`, `.env.example` |
| T-01-07 | Logging, request IDs, errors, error boundaries | Review | Redacting JSON logger, `AppError` family, `toActionError`, `error.tsx`/`global-error.tsx` |
| T-01-08 | Design tokens, UI primitives, message catalog | Review | `@crm/ui` (Button, Input, Label, Dialog, Toaster, Skeleton, ErrorView); `/ui-catalog` (dev only); `@crm/shared/i18n` |
| T-01-09 | Cloud provisioning spike | Blocked | Owner actions: [T-01-09-spike.md](T-01-09-spike.md) |
| T-01-10 | Agent context files and templates | Review | `AGENTS.md`, `CLAUDE.md`, PR template, task template, this board |
| T-01-11 | Instance registry, env sync, release skeleton | Review | `instances/shared-us.json` (placeholders), `pnpm env:sync --dry-run`, `release.yml` (deploys disabled) |

## Phase 2 — Authentication and tenant provisioning (+ Phase 3 foundations)
Plan: [phase-2-plan.md](phase-2-plan.md). **Protected paths changed → human review (H3) required before merge.**

| Task | Title | Status | Evidence / notes |
|------|-------|--------|------------------|
| T-03-01 | Permissions + authz | Review | Full role×permission matrix test (135 cases), role-change/invite guards |
| T-03-02 | Scoped repositories | Review | Member own-scope on list + getById; foreign/invisible IDs → 404 (integration) |
| T-03-04 | Invitations + account creation | Review | Hashed 256-bit single-use tokens, host-bound, 7-day expiry; account rolled back on failure |
| T-03-06 | Audit service | Review | In-transaction audit entries; tenant/agency/platform scopes; TTL field |
| T-03-07 | Action wrappers + registry | Review | tenant/agency/platform/public; Origin required; strict schemas; safe errors. Registry isolation suite (`test/registry`, 103 cases) loads every app's actions and proves cross-origin / anonymous / forged-cookie / under-privileged / cross-tenant / smuggled-key calls are refused; fails if any export is unwrapped |
| T-03-08 | Rate limiter | Review (partial) | Memory backend + policies; **Redis adapter pending (OQ-07)** — hosted envs fail closed |
| T-02-01 | Auth UI (workspace) | Review (partial) | Login, invite accept, reset. **Google button on workspace hosts deferred** until authorized-domain sync (R-02, T-05-07) |
| T-02-02 | Session cookies | Review | Verify → authorize → mint; revocation; host-only HttpOnly/SameSite=Lax; CSRF header + Origin |
| T-02-03 | Password reset | Review | Same response for unknown emails; link via outbox |
| T-02-04 | Workspace provisioning | Review | Transactional, idempotent, quota, slug race-safe |
| T-02-05 | Proxy + tenant context | Review | Real 404 for unknown hosts from proxy (cached lookup); noindex on workspace hosts |
| T-02-06 | Workspace switcher | Review | Active memberships only; links to each canonical host |
| T-02-07 | Platform console | Review | Google + domain allowlist + platformAdmins; agencies/workspaces create + suspend |
| T-02-08 | Branded login | Review (partial) | Workspace name only; full branding in Phase 5 |
| T-02-09 | Agency entity + console | Review | Staff invite/accept, own-agency workspaces only, suspend, entitled create |
| T-02-10 | Privileged protections | Review (partial) | Session lifetimes, re-auth for sensitive actions, login alerts + "not me" revoke, orphan detection. **Scheduled orphan cleanup job + IP allowlist pending** (needs Functions / T-01-09) |

Verification (2026-10-10): format ✓ · lint ✓ · typecheck ✓ · unit 230 ✓ · rules 120 ✓ · integration 46 ✓ · E2E emulator 11 ✓ · E2E smoke 14 ✓ · builds ✓ · prod audit 0 vulns.

Email delivery: outbox only (console provider locally); real provider + sender job in T-05-03.

## Phase 3 — Authorization and database security
**Protected paths changed (`packages/core/**`, `apps/*/src/proxy.ts`, `apps/*/next.config.ts`, `firebase/firestore.indexes.json`) → human review (H3) required before merge.**

| Task | Title | Status | Evidence / notes |
|------|-------|--------|------------------|
| T-03-05 | Member management | Review | Invite/resend/revoke, role change, force sign-out, remove with record reassignment, ownership transfer (re-auth); integration + E2E team lifecycle |
| T-03-09 | Security headers + CSP | Review | Per-request nonce + `strict-dynamic` on workspace/console hosts, static CSP on marketing; E2E asserts zero CSP violations. `cacheComponents`/PPR disabled (incompatible with nonce CSP) |
| T-03-10 | Indexes + TTL | Review | Query-shape registry + index coverage test (missing and unused indexes fail); `scripts/ttl-policies.mjs` prints/applies TTL (apply needs H4) |
| T-03-07 | Registry isolation suite | Review | See Phase 2 table; runs in `pnpm test:integration` (project `registry`) |

Verification (2026-10-10): format ✓ · lint ✓ · typecheck ✓ · unit 240 ✓ · rules 120 ✓ · integration 58 + registry 103 ✓ · E2E emulator 14 ✓ · E2E smoke 8 ✓ · builds ✓ · prod audit 0 vulns.

Phase 3 open items: Redis rate limiter (OQ-07), scheduled orphan cleanup + IP allowlist (need T-01-09 cloud accounts).

## Phase 4 — Core CRM modules
Plan: [phase-4-plan.md](phase-4-plan.md). **Protected paths changed (`packages/core/**`, `firebase/firestore.indexes.json` — now 96 composite indexes) → human review (H3) required before merge; index deploy needs H4.**

| Task | Title | Status | Evidence / notes |
|------|-------|--------|------------------|
| T-04-01 | List infrastructure | Review | Allowlisted filters/sorts (`@crm/shared/records/list-specs`), HMAC-signed cursors bound to the query shape, URL state, cursor trail for "Previous"; query shapes + indexes derived from the specs (`pnpm indexes:gen`, coverage test); E2E journey 9 (no gaps/duplicates under inserts) |
| T-04-02 | Companies | Review | CRUD, detail aggregation (contacts/deals/tasks/timeline, independent sections with inline error), duplicate-domain warning (existence-only for Members) |
| T-04-03 | Contacts & customers | Review | CRUD, company link + counts, duplicate-email warning, lifecycle stage + system activities, Customers view |
| T-04-04 | Leads + conversion | Review | One transaction (contact/company/deal + lead status + activity relink ≤ 400, else job queued); concurrent conversion → exactly one wins (integration); E2E journey 3 |
| T-04-05 | Pipeline + deals + kanban | Review | Stage moves (drag-and-drop **and** keyboard "Move to stage"), optimistic with rollback, won (→ customer prompt) / lost (reason) / reopen (Manager+), column count + sum via aggregation, pipeline editor (2–15 stages, deal moves on removal) |
| T-04-06 | Tasks + My tasks | Review | Due date/time in the actor's zone → UTC; date-only reminders at 09:00 assignee-local (`reminderAt`); groups Overdue/Today/Next 7/Later/No date; nav badge via count aggregation; E2E journey 4 (reminder delivery is Phase 6) |
| T-04-07 | Activities + timeline | Review | Composer, newest-first cursor timeline, system events, SafeMarkdown (AST → React elements, no HTML strings) — unit XSS cases + E2E journey 5 |
| T-04-08 | Own-scope verification | Review | Lists, detail, edit, delete, reassign, board, timeline, duplicate checks, reference pickers all own-scoped for Members (integration TC-RBAC-004 + E2E journey 17); related records not visible → plain label |
| T-04-09 | Trash | Review | Soft delete, Manager+ restore/purge, purge removes exclusive activities and unlinks a purged company; `purgeExpiredTrash` (30 days) ready for the scheduler (needs Functions, T-01-09); E2E journey 11 |
| T-04-10 | Tags | Review | Normalized tags (≤ 20/record), tenant catalog (≤ 500) maintained in-transaction, TagInput with suggestions, tag filter |
| T-04-11 | Settings & profile | Review (partial) | Workspace settings (IANA zone, locale, ISO currency, formats) and profile (name, time zone, theme; member name snapshots). **Avatar upload (Phase 5 uploads) and notification preferences (Phase 6) pending** |

Verification (2026-10-10): format ✓ · lint ✓ · typecheck ✓ · unit 391 ✓ · rules 120 ✓ · integration 84 + registry 228 ✓ (312) · E2E emulator 21 ✓ (0 CSP violations) · E2E smoke 8 ✓ · builds ✓ · `indexes:gen --check` ✓ · prod audit 0 vulns.

**Read budget baseline (TC-COST-001, by query plan):** list page = 26 docs + 1 count (+1 when a filter returns nothing); detail = 1 record + ≤ 2 reference checks + 3 related sections × (≤ 11 docs + 1 count) + timeline 21; board = per open stage ≤ 20 docs + 1 aggregation; My tasks ≤ 200 docs; nav badge 1 count. Every authenticated page also reads the member list once (owner names) — move to a cached snapshot before large teams (follow-up).

Phase 4 open items: E2E journeys run on desktop Chromium only (viewport matrix is Phase 7); bulk actions not built (single-record reassign/delete only); global search is Phase 6 (search tokens are already written).

## Phase 5 — White-label customization
Plan: [phase-5-plan.md](phase-5-plan.md). **Protected paths changed (`packages/core/**`, `apps/web/src/proxy.ts`, both `next.config.ts` — Server Action body limit 2 MB, `apps/web/src/app/api/brand`, `firebase.json` scripts) → human review (H3); domain operations are H11.**

| Task | Title | Status | Evidence / notes |
|------|-------|--------|------------------|
| T-05-01 | Branding + upload pipeline | Review | Type from bytes (sharp), SVG/animated/HTML-as-PNG refused, size/dimension limits, re-encode strips EXIF, content-hash names, `/api/brand` (immutable, `nosniff`, sandbox CSP); branded login (logo, name, colours, favicon, title) — integration + E2E journey 8 |
| T-05-02 | Theme derivation | Review | WCAG contrast (≥ 4.5 text, ≥ 3 UI), OKLCH lightness suggestion, CSS variables in a nonced `<style>` (validated hex only), live light/dark preview; extreme-colour unit tests |
| T-05-03 | Email layer | Review (partial) | Provider interface, branded HTML/text templates (all values escaped), subject/intro overrides (allowlisted variables, no HTML/links), outbox claim + retries → dead after 5, preview (sandboxed iframe) + test send (10/day). Resend adapter implemented and API key bound to `onMailQueued`; sender domains remain T-05-08. |
| T-05-04 | Plans & entitlements | Review | Plan templates (placeholders until the plan table is confirmed), platform overrides + typed feature flags, record limit in the creating transaction (create/restore/convert), seat limit at invite (incl. outstanding invites) and acceptance, read-only gate in the action wrapper, powered-by (plan ∧ agency), platform plan editor |
| T-05-05 | Usage | Review | Usage page, 80 %/100 % banners, `reconcileUsage` job body (count aggregations; scheduling with Functions, T-01-09) |
| T-05-06 | Branding inheritance | Review | Platform → agency → workspace (only if `allowWorkspaceBranding`), resolved at read time from the 60 s config cache (≤ 60 s AC) |
| T-05-07 | Domains | Review (partial) | Add → DNS records → check → active → main address → remove; one workspace per host; fallback host 301 → canonical (proxy); agency base domain + subdomains; scheduled check body. Mock provider in local/test/E2E. **Vercel + Identity Toolkit adapters written but unverified — verify endpoints in T-01-09 before real use** |
| T-05-08 | Agency sender domains | Deferred | With the Resend integration |
| T-05-09 | Agency console | Review | Workspace detail (status, plan, seats, records, domains, branding), agency branding defaults, base domain, staff list + invite (owners) |

Verification (2026-10-10): format ✓ · lint ✓ · typecheck ✓ · unit 417 ✓ · rules 120 ✓ · integration + registry 484 ✓ · E2E emulator 24 ✓ (0 CSP violations) · E2E smoke 8 ✓ · builds ✓ · `indexes:gen --check` ✓ · prod audit 0 vulns.

Phase 5 open items: sender domains (T-05-08), real Vercel/Identity Toolkit verification and the 10-minute domain-check scheduler (T-01-09), branded emails verified in a staging inbox (SPF/DKIM), agency-level email template defaults UI (stored values are already honoured), avatar upload (FR-SET-002; pipeline supports `avatar`).

## Phase 6a — Search, reporting, notifications, data tools
Plan: [phase-6-plan.md](phase-6-plan.md). **Protected paths changed (`packages/core/**`, `firebase/firestore.indexes.json` — now 123 composite indexes incl. one collection-group index, `firebase.json` (functions source), `apps/web/src/app/api/imports` + `api/files`, new `functions/`) → human review (H3). Tenant purge and erasure are destructive: review the tests.**

| Task | Title | Status | Evidence / notes |
|------|-------|--------|------------------|
| T-06-01 | Global search | Review | Ctrl/Cmd+K palette, word-prefix tokens (written on save + backfill job), one indexed query per entity, own-scoped, rate-limited; E2E journey 10 |
| T-06-02 | Dashboard | Review | Aggregation-only KPIs (pipeline by stage, won this/last month, new leads, 90-day conversion, my tasks, recent activity); Members own data, others with owner filter; widgets fail independently |
| T-06-03 | Reports | Review | Pipeline, won vs lost (12 months), lead-source conversion, activities by user × type; tenant-timezone ranges (≤ 12 months); accessible tables with decorative bars; CSV for Manager+ |
| T-06-04 | In-app notifications | Review | Assigned / task due / invitation accepted / job finished / role changed; bell with unread count (polling 60 s + navigation), own notifications only, mark read / all, 90-day TTL |
| T-06-05 | Email notifications + reminders | Review | Per-workspace preferences, branded emails with title only, signed one-click unsubscribe page; reminder scheduler body (collection-group, exactly-once per due time, re-armed on due change) |
| T-06-06 | CSV import | Review | Upload route (CSRF + ≤ 10 MB, private bucket, uploader-only), auto-mapping, 50-row preview with error count, duplicate handling, plan limit check, 500-row resumable chunks through the form services, error report CSV; E2E journey 6 |
| T-06-07 | Exports | Review | List CSV (Manager+, ≤ 50k, filter audited) and full tenant export (Owner: JSONL + CSVs, only this tenant — integration TC-TEN-006); formula neutralisation; authenticated download route (24 h); E2E journey 7 |
| T-06-08 | Audit viewer | Review | Owner/Admin, action **or** actor + date range, cursor pages, CSV when `features.auditExport` |
| T-06-09 | Privacy | Review | DSAR export (JSON + CSV, audited); erasure (Admin+, re-auth, skips trash, redacts deals/tasks, hashed erasure log); self-service account deletion (blocked for owners/agency staff, records to workspace owner); E2E journey 14 |
| T-06-10 | Tenant deletion | Review | Owner + re-auth + typed slug → 30-day pending (members blocked; Owner sees only "Cancel deletion"); purge job: recursive delete, host mappings, storage prefixes, slug quarantine 90 days, tombstone, post-purge verification |
| T-06-14 | Agency usage report | Review | Per-workspace seats/records/plan/billing state/active users (30 days, from workspace sign-ins) + CSV; no CRM content |
| — | Cloud Functions wiring | Review (not deployed) | `functions/`: job trigger, mail outbox trigger, reminders (5 min), domain checks (10 min), nightly trash purge + usage reconcile + stuck-job resume + tenant purge; bundled with esbuild; deploy in T-01-09 |

Verification (2026-10-10): format ✓ · lint ✓ · typecheck ✓ (incl. functions) · unit 456 ✓ · rules 120 ✓ · integration + registry 616 ✓ · E2E emulator 29 ✓ (0 CSP violations) · E2E smoke 8 ✓ · builds ✓ · functions bundle ✓ · `indexes:gen --check` ✓ · prod audit 0 vulns.

### Phase 6b — Payments (2026-11-05)
Plan: [phase-6-plan.md §6b](phase-6-plan.md). Gateway APIs verified against official docs 2026-11-05 (corrections applied: Stripe period end on subscription items; Razorpay boolean `cancel_at_cycle_end`; PayPal cancel needs `reason`, pricing under `billing_cycles`, verify via `/v1/notifications/verify-webhook-signature`). **Human approval required (H10)**: payments code, new protected route `apps/web/src/app/api/webhooks/[provider]/[agencyId]/route.ts`, Secret Manager usage.

| Task | Title | Status | Evidence / notes |
|------|-------|--------|------------------|
| T-06-11 | Gateway abstraction + Razorpay + webhooks | HumanApproval | `packages/core/src/payments/`: `PaymentGateway`, Razorpay/Stripe/PayPal adapters over `fetch` (no SDKs), secret store (Secret Manager REST in hosted envs, emulator-only local store; `SECRETS_BACKEND`), webhook route (raw body, per-agency signature, event-ID idempotency, workspace from our `subscriptionIndex`, state re-fetched from the gateway), Function trigger + nightly reconciliation. TC-BILL-003: forged, foreign-agency, unknown, duplicate and payload-only events change nothing (integration + E2E) |
| T-06-12 | Lifecycle + billing UX | HumanApproval | `deriveBillingState` (active / past_due 7-day grace / read_only / cancelled-until-period-end / manual); workspace Settings → Billing (plan, status, next date, history, hosted-checkout redirect restricted to gateway domains, cancel); agency console Billing (write-only credentials, masked key, owner + re-auth, audited + email alert T27; plan price mapping validated against the gateway and agency currency); manual billing per workspace (FR-BILL-005) |
| T-06-13 | PayPal + Stripe adapters | HumanApproval | Shared contract suite (TC-BILL-001) passes for all three against fake APIs built from the documented shapes (25 tests). **Sandbox runs need keys** (owner) |

Tests: contract 25 · billing integration 18 · E2E billing (subscribe → hosted checkout → signed webhook → plan active; forged webhook 400; admin read-only). Mock gateway (`TEST_GATEWAY_MOCKS`, emulator-only) for local/E2E.

Open: sandbox verification with real Razorpay/Stripe/PayPal test keys; a live low-value payment + refund before launch (T-11-04 gate).

## Phase 7 — Responsive UI and accessibility
Plan: [phase-7-plan.md](phase-7-plan.md). Mostly app/UI code; core change: E2E-only `TEST_RATE_LIMIT_SCALE` (rejected in hosted envs) → H3 review.

| Task | Title | Status | Evidence / notes |
|------|-------|--------|------------------|
| T-07-01 | Responsive | Review | Sidebar ≥ lg, focus-trapped drawer below (`aria-current`); list cards < md; dialogs full-screen on phones; board columns ≈ 85 vw; sticky header with scroll padding. E2E on 360 / 768 / 1280: no horizontal overflow on 12 main routes, drawer navigation, board move |
| T-07-02 | Accessibility audit | Review (manual part pending) | axe (WCAG 2.0–2.2 A/AA) on 28 workspace routes in light **and** dark, open dialogs, search palette, signed-out pages, agency/platform console pages → 0 serious/critical. Fixed: destructive button contrast, landmark structure (`main` per layout, header/nav outside), duplicate region names, small target size, label-in-name on the brand link, serif fallback font (broken `--font-sans` token). **Screen-reader pass:** [a11y-screen-reader-checklist.md](a11y-screen-reader-checklist.md) (manual, owner/QA) |
| T-07-03 | Keyboard journeys | Review | Keyboard-only E2E: sign in, skip link, create contact, move deal via "Move to stage" (WCAG 2.5.7), complete task with Space, Escape returns focus to the trigger; focus never on `<body>`, visible indicator |
| T-07-04 | Visual baselines | Review | Dashboard, contacts, deal, board, login × light / dark / extreme brand (#FFFF00); per-platform snapshots (Windows set committed; CI writes its Linux set on first run via `updateSnapshots: "missing"`); volatile dates masked |
| T-07-05 | States | Review | Route loading + segment error boundary (support reference), offline banner, session-expired dialog (sign in in a new tab, page state kept), undo toast for task completion, "Showing your records" for Members, reduced motion, user theme applied without inline script, focus to page heading on navigation |

Verification (2026-10-10): format ✓ · lint ✓ · typecheck ✓ · unit 456 ✓ · rules 120 ✓ · integration + registry 616 ✓ · E2E emulator 37 ✓ + viewport matrix 3 ✓ (0 CSP violations) · E2E smoke 8 ✓ · builds ✓ · prod audit 0 vulns.

Phase 7 open items: manual screen-reader pass; bulk selection on lists (06 §6, product decision); consistent Help link target (needs Phase 8 docs).

## Phase 8 — SEO, AEO and performance
Plan: [phase-8-plan.md](phase-8-plan.md). Protected paths touched → H-review: `apps/web/src/proxy.ts` and `apps/console/src/proxy.ts` (robots.txt / sitemap / llms.txt per host); `packages/core/**` (new `marketing.ts`, `actions/marketing-actions.ts`, rate-limit policies, `workspace_finder` mail template, read-budget test).

| Task | Title | Status | Evidence / notes |
|------|-------|--------|------------------|
| T-08-01 | Marketing site | Review | Static pages: home, features, agencies, plans (entitlements, no prices), security, about, contact (demo request: strict schema, honeypot, 5/h per IP, stored in `contactRequests` with 1-year TTL; submitter-only confirmation queued atomically), find-workspace (emails sign-in links; same answer for unknown addresses; 5/h per IP + 3/h per address; `noindex`), legal privacy/terms/cookies (**drafts for counsel**, notice shown). Copy in `@crm/shared/content`. Integration tests: storage, mail, honeypot, unknown keys, rate limits, no enumeration, only active workspaces/memberships listed |
| T-08-02 | Docs and AEO | Review | 7 question-led articles (Summary · Steps · Limits · Troubleshooting · Related), FAQ with `FAQPage` matching visible text verbatim (E2E-checked), glossary, client-side docs search (all articles in the HTML), `/llms.txt` |
| T-08-03 | Technical SEO | Review | Unique titles ≤ 60 / descriptions ≤ 155, absolute canonicals from `APP_MARKETING_HOST`, OG/Twitter with a generated 1200×630 PNG at `/og-image`, JSON-LD (Organization, WebSite, SoftwareApplication, FAQPage, TechArticle, BreadcrumbList) via a serializer that throws for non-marketing hosts, `robots.txt` + `sitemap.xml` (lastmod from content, find-workspace excluded) |
| T-08-04 | Index policy | Review | Root layout defaults to `noindex`; marketing pages opt in. Workspace hosts: proxy serves `robots.txt` (`Allow: /`, `Disallow: /api/`) with `X-Robots-Tag: noindex`; `sitemap.xml` / `llms.txt` 404. Consoles: `Disallow: /`. E2E: TC-SEO-001/002 (metadata on 14 pages, unique titles, JSON-LD parse, robots/sitemap/llms, workspace-host policy, OG image) + axe on 15 public pages |
| T-08-05 | Budgets | Review (Lighthouse perf pending staging) | Initial JS (gzip, excluding `nomodule` polyfills) as E2E tests: public ≤ 150 KB (`/`, `/docs`, article, `/contact` ≈ 142 KB), app ≤ 250 KB (dashboard, list, board, form). Fixes to get there: Toaster moved out of the root layout, light error boundary (no Button), base i18n catalog split (`@crm/shared/i18n/base`), native marketing form controls, `signOutEverywhere` split from the Firebase client SDK (`@crm/shared/auth-session`). `pnpm perf:lighthouse` (median of 3, Lighthouse via `pnpm dlx`): SEO / best practices / accessibility **100** on all pages; performance median 0.87–0.95 on this laptop (home and article borderline under 0.90 — Lantern charges React hydration under 4× CPU throttling). Re-measure on staging before calling it met. RUM: `web-vitals` 10% sample on public pages → `/api/vitals` (logs only) |
| T-08-06 | Cost review | Review (alerts need GCP project) | [T-08-06-cost-review.md](T-08-06-cost-review.md): measured reads per view (all within 03 §11; app shell 9 reads, newly budgeted), monthly model, billing-alert runbook. Change: notification bell no longer polls from hidden tabs. Recommendations R1–R4 not yet done |

Verification (2026-10-10): format ✓ · lint ✓ · typecheck ✓ · unit 462 ✓ · rules 120 ✓ · integration + registry 635 ✓ (incl. read budgets) · E2E smoke + SEO 35 ✓ · E2E emulator 38 ✓ + viewport matrix 3 ✓ · builds ✓ · prod audit 0 vulns (dev: 3 advisories in `firebase-tools` transitive deps).

Phase 8 open items: Lighthouse performance on staging; legal pages need counsel review; brand name placeholder `CRM` (OQ-16); billing alerts after T-01-09; cost recommendations R1–R4; `Offer` markup only once real prices exist.

## Phase 9 — Security hardening and automated testing
Plan: [phase-9-plan.md](phase-9-plan.md). Protected paths touched → **human security sign-off required**: `packages/core/**` (session binding, rate limiter, upload gates, logger), `apps/console/src/app/api/auth/not-me/route.ts`, `apps/web/src/app/api/vitals/route.ts`, `apps/console/src/server/access.ts`, `.github/workflows/ci.yml`. New secrets: `SESSION_BINDING_SECRET` (web + console, same value), `RATE_LIMIT_REDIS_URL` / `RATE_LIMIT_REDIS_TOKEN`.

| Task | Title | Status | Evidence / notes |
|------|-------|--------|------------------|
| T-09-01 | Security review | HumanApproval | [T-09-01-security-review.md](T-09-01-security-review.md): 0 Critical. Fixed: F-01 hosted rate limiter (Upstash REST; sign-in/public fail closed, per-user fail open), F-03 session cookies HMAC-bound to surface + host, F-02 upload route gates/limits, F-06 value-level log scrubbing, F-04 "not me" confirm page + POST, F-05 vitals limit, F-07 unknown roles. Open: **F-08 upload size vs Vercel 4.5 MB → OQ-26**. Accepted: F-09 same-second revocation window |
| T-09-02 | Isolation suites | Review | Registry suite covers every exported action (incl. new marketing actions); new: cross-host and cross-surface cookie replay (integration + `e2e/isolation.spec.ts`), tampered/unbound cookies, lifecycle gates, scoped-repository edge cases |
| T-09-03 | DAST | Blocked (staging, T-01-09) | `security/zap/run-baseline.sh` + `zap-baseline.conf` (fail on High) ready |
| T-09-04 | Secret/bundle scan, SBOM | Review | `pnpm scan:bundles` (server env names from the schema + key-material patterns; planted-leak check verified) and `pnpm sbom` (CycloneDX, 440 components) in CI; gitleaks in CI; prod audit 0 |
| T-09-05 | Coverage thresholds | Review | 09 §10 thresholds enforced in `vitest.config.mts` over unit + component + integration + registry (`pnpm test:coverage`, CI integration job): overall 88.7 % lines / 76.9 % branches; critical core, services, shared, UI, features all above their floors. New: per-app component test projects (`dom-web`, `dom-console`) (92 web + 15 console component tests; 20 UI). Bug found and fixed: TagInput kept a duplicate tag in the input |
| T-09-06 | Load + revocation | Blocked (staging) | `load/k6-mixed.js` (200 VUs, 15 min, p95 thresholds), `scripts/k6-actions.mjs`, `load/revocation-latency.mjs` (validated locally on emulators: 39 ms) — see `load/README.md` |
| T-09-07 | External pentest | Ready (owner to commission) | Scope: [T-09-07-pentest-scope.md](T-09-07-pentest-scope.md) |
| T-09-08 | Observability | Review (alerts need GCP) | Log fields + redaction tests (TC-OBS-001); alert definitions with real log names: [T-09-08-observability.md](T-09-08-observability.md) |

Verification (2026-10-10): format ✓ · lint ✓ · typecheck ✓ · unit + component 600 ✓ · rules 120 ✓ · coverage run (unit + integration + registry) 1,268 ✓ with all thresholds met · E2E emulator 40 ✓ + viewport 3 ✓ · E2E smoke + SEO 35 ✓ · builds ✓ · bundle scan ✓ · prod audit 0 vulns.

Phase 9 open items: human security sign-off; OQ-26 (upload size); staging runs of ZAP, k6 and revocation; external pentest; alert wiring (T-11-02).

## Phase 10 — Staging validation and UAT
Plan: [phase-10-plan.md](phase-10-plan.md). All runs need staging (T-01-09, owner action); tooling and scripts are ready. Protected paths touched → human review: `packages/core/**` (erasure re-application, restore compare, pilot provisioning, `FIRESTORE_DATABASE_ID`/`getNamedDb`, `authz.denied` metric), `pnpm-workspace.yaml` overrides.

| Task | Title | Status | Evidence / notes |
|------|-------|--------|------------------|
| T-10-01 | Staging parity | Blocked (staging) | [T-10-01-staging-parity.md](T-10-01-staging-parity.md) (P1–P15); `pnpm env:parity` compares staging/production env files by name — validation per env, missing vars, shared secrets, shared project (unit-tested). Found and fixed: `contactRequests` and `tenantTombstones` had `expireAt` but no TTL policy |
| T-10-02 | UAT environment | Blocked (staging) | `pnpm uat:seed --config uat/pilot.json` — pilot agency + 3 workspaces (platform host, agency subdomain, custom domain) via the real provisioning/domain services; idempotent; refuses production; integration-tested and smoke-run on emulators |
| T-10-03 | UAT | Blocked (staging, testers) | [T-10-03-uat-scripts.md](T-10-03-uat-scripts.md): UC-01..13 steps with expected results, G-2 timing sheet, sign-off. UC-10 ready (needs gateway test keys on staging); large imports blocked by OQ-26 |
| T-10-04 | Restore drill | Blocked (staging backups) | [T-10-04-restore-drill.md](T-10-04-restore-drill.md); `pnpm restore:drill` = `compareDatabases` (counts + sample checksums, IDs only) + `reapplyErasures` (R-09: hashed erasure log matched against restored contacts; idempotent; audited as `privacy.erasure_reapplied`, not re-logged). Integration-tested; smoke-run on emulators |
| T-10-05 | Triage + regression | Ready | Regression set defined in the plan |

Also: `authz.denied` warn log from the action wrappers (action, context, reason, pseudonymous IDs) for the 10 §10 security alert — tested.

Dependency security update (2026-11-04): new advisories included **two Critical Next.js RCEs** (image optimization, `use cache`) affecting the console (16.4.0) → console aligned to Next 16.4.3 (web already was); zod 4.6.7; overrides for body-parser, re2js, qs. Prod audit now 0 high/critical; 2 moderate remain (old `glob`/`minimatch` under `functions` → google-gax → rimraf; can't be forced without breaking that API — watch for upstream fix).

Verification (2026-11-04): format ✓ · lint ✓ · typecheck ✓ · unit + component 607 ✓ · rules 120 ✓ · coverage run 1,281 ✓ (88.9 % lines / 77.2 % branches, all thresholds met) · E2E emulator 40 ✓ + viewport 3 ✓ (one earlier run failed and didn't reproduce on rerun) · smoke + SEO 35 ✓ · builds ✓ · bundle scan ✓ · prod audit: 0 high/critical.

Phase 10 open items: everything runs on staging (T-01-09); UC-10 needs gateway test keys; OQ-26 decision.

## Phase 11 — Production deployment and post-launch monitoring
Everything here runs against production (T-01-09 accounts, H6 approval). Prepared in repo:

| Task | Title | Status | Evidence / notes |
|------|-------|--------|------------------|
| T-11-01 | Production hardening | Blocked (accounts) | `pnpm ops harden --instance <i> --env production [--billing-account --budget] [--apply]`: APIs, PITR, delete protection, daily + weekly backup schedules, no-SA-keys org policy, budget 50/80/100 % + forecast. Dry-run by default; refuses placeholder projects; unit-tested. Manual: 2SV evidence, Data Access logs, IAM review ([T-11-04-go-live.md](T-11-04-go-live.md)) |
| T-11-02 | Monitoring + alerting | Blocked (accounts) | `pnpm ops monitoring …`: 12 log-based metrics + alert policies (test proves every alerted message exists in code, incl. `authz.denied`, `payment.*`) + uptime checks for www, health, console, partners |
| T-11-03 | DNS, certificates, email auth | Blocked (domains) | [T-11-03-dns-and-email.md](T-11-03-dns-and-email.md): records, `app.` NS delegation for the wildcard, CAA, SPF/DKIM/DMARC, verification table |
| T-11-04 | Go-live | Blocked (H6) | [T-11-04-go-live.md](T-11-04-go-live.md): T-7 tasks, go/no-go gates, rollout + rollback. `scripts/smoke-deploy.mjs` (10 read-only checks: headers/HSTS/CSP, health, robots per host, console noindex, unknown workspace 404, unsigned webhook refused, cross-origin session refused) — 10/10 against local servers; wired into the release workflow |
| T-11-05 | Hypercare | Ready | [T-11-05-hypercare.md](T-11-05-hypercare.md): daily/weekly checks, exit criteria, log |
| T-11-06 | Incident runbooks + on-call | Ready (tabletop pending) | [T-11-06-incident-runbooks.md](T-11-06-incident-runbooks.md): R1 data exposure, R2 privileged compromise, R3 payment manipulation, R4 outage (incl. rate-limit store), R5 email, R6 data loss; rota + tabletop template |

Verification (2026-11-05, after 6b + 11): format ✓ · lint ✓ · typecheck ✓ · unit + component 636 ✓ · rules 120 ✓ · coverage run 1,370 ✓ (87.6 % lines / 75.8 % branches; all thresholds met) · E2E emulator 42 ✓ + viewport 3 ✓ · smoke + SEO 35 ✓ · deploy smoke 10/10 (local) · builds ✓ · bundle scan ✓ · prod audit 0 high/critical (2 moderate in functions' google-gax).

**Everything that can be built without the owner's accounts is built.** Remaining work is owner-side: T-01-09 cloud accounts, gateway sandbox keys, H6/H10/H-security sign-offs, OQ-26, UAT, staging runs (ZAP, k6, restore drill), pentest, go-live.

## Known deviations / follow-ups
- **Downloads use an authenticated route** (`/api/files/{jobId}/{file}`) instead of bearer signed URLs; files still expire after 24 h (FR-IMP-002/FR-TEN-007 intent, stronger access control).
- **Full tenant export** is a JSON Lines file plus per-entity CSVs (no zip), excluding tokens, jobs, billing, and audit logs.
- **Lead → customer conversion** on the dashboard counts leads converted among leads created in the last 90 days.
- **"Active users (30 days)"** is measured from workspace sign-ins (`members.lastSeenAt` set at session creation).
- **Plan templates are code-owned** (`config/entitlements.ts`) rather than `plans/{planId}` documents; per-workspace overrides cover operator adjustments until the plan table (FR-PLAN-001 placeholders) is confirmed.
- **Brand assets are served same-origin via `/api/brand`** instead of a public `assets.` bucket host (no CSP change; works on custom domains). A CDN can front the route later.
- **Branding inheritance is resolved at read time** (cached config docs) instead of a `brandingResolved` trigger-maintained copy (05 §4.2); same ≤ 60 s propagation.
- **Fallback-host redirect** applies to `platform_subdomain` hosts only; agency subdomains that aren't canonical still serve directly.
- **Lists allow one optional filter (incl. tag) plus sort**, not "one filter plus optional tag" (03 §8) — keeps every offered combination indexed with a bounded index count; revisit with saved views (FR-SRCH-003).
- **OG image is a plain route (`/og-image`)**, not the `opengraph-image` file convention: inside the `(marketing)` route group the convention adds a hashed URL and would also apply to other segments.
- **Lighthouse is not a dependency** — `pnpm perf:lighthouse` fetches a pinned version with `pnpm dlx` (it pulls in dev-only advisories otherwise).
- **Deals use the workspace currency** (no per-deal currency in the MVP) so board sums stay single-currency (FR-DEAL-003 AC1 "per currency").
- **Pipeline stage removal moves deals synchronously in chunks** (≤ 400 writes per batch) instead of a background job; fine at A-06 scale.
- `record.purge` shares the `record.restore` grant (same row in the permission matrix).
- **03-database-schema.md repaired (2026-10-10):** a v1.1 edit script used `String.replace` with a replacement containing `$\``, which spliced a duplicate of the document head into §4. The duplicate was removed; no content changed.
- Internal rewrite segments are `t/[host]`, `platform/`, `agency/` (not `_t`): underscore folders are private in the App Router (02 §3 updated).
- Proxy performs the host-mapping lookup (cached 60 s) so unknown hosts get a real 404 (02 §3 updated).
- Session-route CSRF uses a custom header + Origin check instead of a double-submit token (04 §8 updated).
- Platform Google sign-in popup UI is not browser-automated; the server path is E2E-tested via emulator ID tokens.
- Dev-only advisory: `braces` via `firebase-tools` → `chokidar` (no patched version). Production dependencies: 0 known vulnerabilities.
- Coverage thresholds (09 §10) not enforced yet — add once Phase 2+ code exists (T-09-05).
- Packages are not linted yet (apps only); add a shared ESLint config for `packages/*` early in Phase 2.
