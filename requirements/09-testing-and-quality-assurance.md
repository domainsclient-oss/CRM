# 09 — Testing and Quality Assurance

> **Prev:** [08 AI-Agentic Workflow](08-ai-agentic-development-workflow.md) · **Next:** [10 CI/CD](10-ci-cd-and-deployment.md)
> Test IDs (`TC-*`) are referenced from [01](01-product-requirements.md), [04](04-security-and-compliance.md), [11](11-implementation-roadmap.md), and [14](14-traceability-matrix.md).

## Contents

1. [Strategy](#1-strategy)
2. [Tooling](#2-tooling)
3. [Unit and component tests](#3-unit-and-component-tests)
4. [Integration and API tests](#4-integration-and-api-tests)
5. [Multi-tenant isolation and privilege-escalation tests](#5-multi-tenant-isolation-and-privilege-escalation-tests)
6. [Firestore and Storage Security Rules tests](#6-firestore-and-storage-security-rules-tests)
7. [End-to-end tests](#7-end-to-end-tests)
8. [Accessibility, responsive, and visual regression tests](#8-accessibility-responsive-and-visual-regression-tests)
9. [SEO, performance, security, and static analysis](#9-seo-performance-security-and-static-analysis)
10. [Coverage targets](#10-coverage-targets)
11. [Release-blocking tests](#11-release-blocking-tests)
12. [Test case catalog](#12-test-case-catalog)
13. [Test data, fixtures, cleanup, and CI execution](#13-test-data-fixtures-cleanup-and-ci-execution)

---

## 1. Strategy

Risk-based pyramid: most assertions in fast unit/integration tests against the **Firebase Emulator Suite**; E2E covers critical journeys, isolation, and responsiveness; manual testing reserved for screen readers, exploratory, and UAT.

| Level | Scope | Runs | Target count (MVP) |
|-------|-------|------|--------------------|
| Unit | Pure functions: schemas, permissions, theme derivation, search tokens, money/date, CSV sanitization, config resolution | every PR | ~400 |
| Component | `packages/ui` and feature components with RTL + jest-axe/vitest-axe | every PR | ~150 |
| Integration | Services + repositories + actions against Firestore/Auth/Storage emulators | every PR | ~250 |
| Rules | Firestore/Storage rules via `@firebase/rules-unit-testing` | every PR | ~40 |
| E2E | Playwright against `next build && next start` + emulators | every PR (smoke + affected), full nightly | ~120 |
| Non-functional | Lighthouse CI, k6, ZAP, a11y scans, visual regression | PR (subset) / nightly / pre-release | — |

## 2. Tooling

| Purpose | Tool | Notes |
|---------|------|-------|
| Unit/integration runner | **Vitest** | Workspace config per package; `environment: node` for server, `jsdom` for components |
| Component testing | React Testing Library + `@testing-library/user-event` | Query by role/label, not test IDs, where possible |
| A11y assertions | `vitest-axe`/`jest-axe` (unit), `@axe-core/playwright` (E2E) | |
| E2E | **Playwright** (Chromium, Firefox, WebKit; mobile emulation) | Trace on failure, video on retry |
| Firebase | Emulator Suite (Auth, Firestore, Storage, Functions) with `demo-crm` project ID | No real projects in tests |
| Rules | `@firebase/rules-unit-testing` | |
| Async Server Components | Tested via E2E / integration of `queries.ts` functions (RTL support for async RSC limited — **verify**) | |
| Performance | Lighthouse CI, k6, bundle analyzer, size-limit | |
| Security | CodeQL, gitleaks, `pnpm audit`, OWASP ZAP baseline | |
| Structured data | Schema validation (`schema-dts` types + JSON-LD validator script) | |
| Time control | Vitest fake timers; injectable `Clock` in services | For reminders, expiry, TTL logic |

## 3. Unit and component tests

Mandatory unit coverage areas:
- **Permissions:** table-driven test over every `Role × Permission` asserting exactly the matrix in [01 §4.3](01-product-requirements.md#43-permission-matrix) (TC-RBAC-002); role-change guard combinations (TC-RBAC-003).
- **Schemas:** every Zod schema: valid fixture passes; each field's boundary (min/max/invalid type/unknown key) fails with field-specific errors (TC-SEC-005).
- **Theme derivation:** property-based tests (fast-check) — for 1,000 random colors, outputs either a contrast-compliant theme or a `ContrastError` with compliant suggestion (TC-BRAND-002).
- **Search tokens:** normalization, diacritics, caps (TC-SRCH-001).
- **CSV sanitizer:** formula prefixes, quotes, newlines (TC-IMP-002).
- **Config resolution:** platform → plan → tenant overrides; unknown keys dropped (TC-PLAN-003).
- **Cursor encode/decode:** HMAC tamper detection (TC-SRCH-002).

Component tests: each `packages/ui` component — renders accessible name/role, keyboard interaction (Enter/Space/Escape/Arrow keys), focus return, error states, axe zero violations.

## 4. Integration and API tests

Run against emulators with seeded fixtures. Each Server Action and Route Handler gets:

| Test type | Assertion |
|-----------|-----------|
| Happy path | Correct result + persisted document + audit log entry + system activity where applicable |
| Validation | Invalid payloads → `VALIDATION` with field errors; unknown keys rejected |
| Authn | No session → `UNAUTHENTICATED`/401 |
| Authz | Each disallowed role → `FORBIDDEN`; `own` scope enforced |
| Isolation | Cross-tenant IDs → `NOT_FOUND` (see §5) |
| Concurrency | `expectedUpdatedAt` mismatch → `CONFLICT`; concurrent slug/invite/conversion → exactly one succeeds |
| Limits | Plan limits → `PLAN_LIMIT_EXCEEDED` |
| Rate limits | Exceeding policy → `RATE_LIMITED` (with in-memory limiter adapter in tests + one test against real Redis-compatible container nightly) |
| Errors | Repository failure → `INTERNAL` with requestId; no stack trace in result |

Route Handlers additionally: HTTP status codes, headers (`Cache-Control`, security headers), CSRF/Origin rejection.

Functions: trigger tests with emulator (import chunks, export generation, reminders with fake clock, purge jobs, denormalization fan-out), idempotency (run twice → same result).

## 5. Multi-tenant isolation and privilege-escalation tests

Generated, table-driven suite (`packages/testing/isolation`) so that **adding a new action automatically requires adding it to the registry** (a test fails if an exported action is not registered).

```ts
// PSEUDOCODE — isolation suite generator
for (const action of ACTION_REGISTRY) {                       // every exported Server Action
  for (const entity of action.entityRefs) {                   // fields that reference records
    it(`${action.name}: cross-tenant ${entity} → NOT_FOUND`, async () => {
      const ctx = asUser('acme.member')
      const res = await call(action, ctx, payloadWith(entity, GLOBEX_IDS[entity]))
      expect(res).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
      await expectNoWrites('globex')                          // snapshot diff of Globex subtree
    })
  }
  for (const role of rolesWithout(action.permission)) {
    it(`${action.name}: role ${role} → FORBIDDEN`, async () => { /* ... */ })
  }
  it(`${action.name}: injected tenantId/role/ownerUid rejected`, async () => { /* ... */ })
}
```

Scenarios covered (IDs in §12): IDOR by ID (TC-SEC-001), payload tenant forging (TC-SEC-002), lower-role escalation (TC-SEC-004), reference smuggling + search/report/export/notification leakage (TC-SEC-012), cache leakage (TC-SEC-013), suspended tenant sessions (TC-SEC-015), cross-host cookie and multi-membership (TC-TEN-007), internal rewrite path access (TC-TEN-004), owner/admin role-change rules (TC-RBAC-003), invitation misuse (TC-RBAC-001), privileged console access controls (TC-AUTH-007), cross-agency access (TC-AGY-003), agency-to-CRM access (TC-AGY-002), Member own-scope (TC-RBAC-004), webhook forgery (TC-BILL-003).

E2E counterpart (Playwright): two browser contexts (Acme member, Globex admin) manipulate URLs and replay captured Server Action requests with swapped IDs.

## 6. Firestore and Storage Security Rules tests

With ADR-003 (deny-all), tests prove the client SDK cannot access any path:

| Case | Expected |
|------|----------|
| Unauthenticated read/write on every collection in [03 §2](03-database-schema.md#2-collection-tree) (root and tenant subcollections, sample IDs) | denied |
| Authenticated user (member of Acme) read/write own tenant docs, own `users/{uid}`, own notifications | denied |
| Authenticated user with forged custom claims (`tenantId`, `role`, `admin: true`) | denied |
| Storage: read/write `brand/`, `imports/`, `exports/` paths as anon and authed | denied (brand bucket public read is IAM-level and tested separately via HTTP: list denied, object GET allowed) |
| Rules file lint | no `if true`, no wildcard allow (CI grep) |

If a future ADR enables client reads, this section must be expanded with positive and negative cases per path before rules change (H3).

## 7. End-to-end tests

Environment: production build + emulators + seeded fixtures; base URLs use `*.localhost` subdomains (e.g., `acme.app.localhost:3000`) to exercise host routing, plus simulated custom/agency domains (`crm.acme.test`, `globex.crm.agency-one.test`) via hosts-file entries in CI (**verify** browser resolution of `*.localhost`).

Critical journeys (each a TC in §12):
1. Platform staff (Google, allowlisted domain) creates agency → agency owner accepts invite on partners host → platform provisions workspace with custom domain (Vercel API mocked) → owner accepts invite on workspace host (account created server-side) → signs in → onboarding (TC-AGY-001, TC-TEN-001, TC-TEN-008, TC-AUTH-001, TC-AUTH-007).
2. Invite member → accept (wrong email rejected) → member signs in (TC-RBAC-001).
3. Lead create → convert (contact+company+deal) → deal moved across stages (drag and keyboard) → won with customer stage update (TC-LEAD-002, TC-DEAL-003, TC-DEAL-004, TC-CON-004).
4. Task create → appears in My tasks → reminder notification (fake clock in functions emulator) → complete (TC-TASK-001..003).
5. Log activities → timeline order and sanitization (TC-ACT-001, TC-SEC-010).
6. Import CSV with errors → error report → list shows imported rows (TC-IMP-001).
7. Export list → download → formula cells neutralized (TC-IMP-002).
8. Branding update → visible on login + emails preview; invalid upload rejected (TC-BRAND-001..003).
9. Lists: filter, sort, paginate forward/back with concurrent inserts (TC-SRCH-002).
10. Global search (TC-SRCH-001).
11. Soft delete → trash → restore (TC-REC-001).
12. Password reset (TC-AUTH-003), sign out everywhere (TC-AUTH-005).
13. Workspace suspension by agency, then agency suspension by platform → members blocked (TC-TEN-002, TC-SEC-015).
17. Member own-scope: Raj vs Lena across lists, detail URLs, search, kanban, dashboard, reports, export (TC-RBAC-004).
18. Subscription: owner subscribes via Razorpay test mode (hosted page; sandbox or recorded mock) → webhook → plan active; failed renewal → past_due → read-only → payment → active (TC-BILL-002, TC-BILL-003).
19. Agency console: Agency One staff manage only their workspaces; branding inheritance visible on workspace (TC-AGY-003, TC-AGY-004, TC-AGY-005).
14. DSAR export/erasure (TC-PRIV-001/002); account deletion (TC-PRIV-003).
15. Form validation: required fields, invalid email/phone/amount, server-side error mapping (TC-CON-001, TC-DEAL-001).
16. Error handling: simulated server failure (fault-injection flag in test env only) shows error state with requestId and preserves form input.

## 8. Accessibility, responsive, and visual regression tests

| Test | Method | Pass criteria |
|------|--------|--------------|
| TC-A11Y-001 automated | `@axe-core/playwright` on every route in a route manifest (authenticated + public), light & dark, with default and extreme tenant brand | 0 serious/critical violations; moderate triaged |
| TC-A11Y-002 keyboard | Playwright scripts performing journeys 1, 3, 4, 8 using keyboard only; assert focus visible & order | All steps completable; focus never lost to `<body>` |
| TC-A11Y-003 screen reader | Manual checklist (NVDA, VoiceOver macOS/iOS, TalkBack) for journeys 1, 3, 4, 6 | No blockers; findings logged |
| TC-RESP-001 viewports | Playwright projects: **360×800** (Android), **390×844** (iPhone, WebKit), **768×1024** (tablet), **1280×800** (laptop), **1920×1080** | Journeys 3, 4, 9 complete; no horizontal page overflow (`document.documentElement.scrollWidth <= innerWidth`) except designated scroll regions; touch targets ≥ 24 px |
| TC-VIS-001 visual | `toHaveScreenshot` for UI catalog + 12 key screens × 3 viewports × 2 themes | ≤ 1% pixel diff or approved update |

## 9. SEO, performance, security, and static analysis

| Check | Tool | Gate |
|-------|------|------|
| Lint | ESLint (incl. custom rules: no raw Firestore in features, wrapped actions, no `dangerouslySetInnerHTML`, no tenantId in schemas) | Error = fail |
| Types | `tsc --noEmit` per package | fail on error |
| Formatting | Prettier check | fail |
| Dependency audit | `pnpm audit --prod --audit-level=high` | fail (exceptions file with expiry) |
| SAST | CodeQL | fail on High |
| Secrets | gitleaks | fail |
| SEO | Playwright checks: titles, descriptions, canonicals, robots meta/headers per host class, sitemap contents, JSON-LD parse + schema validation (TC-SEO-001/002) | fail |
| Lighthouse CI | Public pages: perf ≥ 90, SEO ≥ 95, a11y 100, BP ≥ 95 | fail |
| Bundle budgets | size-limit per route group | fail |
| Load | k6: 200 VUs mixed read/write against staging, 15 min (TC-PERF-002) | p95 thresholds |
| DAST | ZAP baseline on staging | fail on High |

## 10. Coverage targets

Coverage is a floor, not the goal; risk-weighted:

| Area | Lines | Branches |
|------|-------|----------|
| `packages/core` authz, session, tenant-context, actions wrapper, repositories base | **95%** | **90%** |
| `packages/shared` schemas, permissions, branding theme, search, csv | 90% | 85% |
| Services (`packages/core/services`) | 85% | 75% |
| Functions (`functions/`) | 80% | 70% |
| UI components (`packages/ui`) | 75% | 60% |
| Feature components | 60% | 50% |
| **Overall** | **≥ 80%** | **≥ 70%** |

Plus: 100% of Server Actions in isolation registry; 100% of permissions in matrix test; 100% of routes in a11y manifest; 100% of query shapes executed in integration tests.

## 11. Release-blocking tests

A production release is blocked if any of these fail (also listed in [13](13-release-readiness-checklist.md)):

TC-SEC-001 · TC-SEC-002 · TC-SEC-003 · TC-SEC-004 · TC-SEC-005 · TC-SEC-006 · TC-SEC-008 · TC-SEC-009 · TC-SEC-010 · TC-SEC-011 · TC-SEC-012 · TC-SEC-013 · TC-SEC-015 · TC-SEC-016 · TC-AUTH-001 · TC-AUTH-003 · TC-AUTH-004 · TC-AUTH-005 · TC-AUTH-007 · TC-AGY-001 · TC-AGY-002 · TC-AGY-003 · TC-BILL-003 · TC-TEN-008 · TC-TEN-001 · TC-TEN-002 · TC-TEN-003 · TC-TEN-004 · TC-TEN-005 · TC-TEN-007 · TC-RBAC-001 · TC-RBAC-002 · TC-RBAC-003 · TC-RBAC-004 · TC-LEAD-002 · TC-AUD-001 · TC-AUD-003 · TC-PRIV-002 · TC-SEO-001 · TC-A11Y-001 · TC-A11Y-002 · TC-RESP-001 · TC-REL-001 · all P0 functional TCs in §12 marked **RB**.

## 12. Test case catalog

Level: **U** unit · **C** component · **I** integration (emulator) · **R** rules · **E** E2E · **M** manual · **N** non-functional. **RB** = release-blocking.

| Test ID | Title / scenario | Level | Requirement(s) | RB |
|---------|------------------|-------|----------------|----|
| TC-AUTH-001 | Invitation-only account creation (server-side `createUser`, email verified via invite); direct client/REST sign-up yields no access and is flagged by orphan cleanup; generic login error | I,E | FR-AUTH-001 | RB |
| TC-AUTH-002 | Google sign-in establishes session; no duplicate account | E | FR-AUTH-002 | |
| TC-AUTH-003 | Password reset: identical response for unknown email; sessions revoked after reset | I,E | FR-AUTH-003 | RB |
| TC-AUTH-004 | Session cookie flags; `auth_time` freshness; tampered/expired cookie rejected; reauth required for sensitive ops | I,E | FR-AUTH-004 | RB |
| TC-AUTH-005 | Sign-out revokes; forced sign-out by admin; revoked cookie rejected next request | I,E | FR-AUTH-006 | RB |
| TC-AUTH-006 | *(Deferred with FR-AUTH-005)* Console requires MFA claim; enrollment forced | I,E | FR-AUTH-005 | — |
| TC-AUTH-007 | Privileged controls: non-allowlisted Google domain rejected on console; password sign-in impossible for platform staff; session max age 8 h/12 h enforced; re-auth required for sensitive actions; login alert sent on new device; "not me" link revokes sessions | I,E | FR-AUTH-008 | RB |
| TC-TEN-001 | Provisioning (platform; entitled agency only) creates all docs incl. owner invite; idempotent retry; agency quota; **no public route creates workspaces or accounts** (route manifest scan + REST attempts) | I,E | FR-TEN-001 | RB |
| TC-TEN-002 | Suspend/reactivate; ≤ 60 s effect; jobs skipped | I,E | FR-TEN-002 | RB |
| TC-TEN-003 | Slug syntax, reserved words, concurrent creation → one winner | U,I | FR-TEN-003 | RB |
| TC-TEN-004 | Host resolution; unknown host neutral 404; `/_t/*` blocked; host-header allowlist | I,E | FR-TEN-004 | RB |
| TC-TEN-005 | Deletion request, cancel, purge leaves zero docs/files; slug quarantined | I | FR-TEN-006 | RB |
| TC-TEN-006 | Full export contains only tenant data; signed URL expiry; file lifecycle | I | FR-TEN-007 | |
| TC-TEN-007 | Multi-membership switcher; host-only cookies; role per tenant | E | FR-TEN-008 | RB |
| TC-TEN-008 | Custom domain lifecycle with mocked Vercel API: pending → verifying → active; not routable before active; conflicts; canonical switch + 301; authorized-domain sync; removal cleanup | I,E | FR-TEN-005 | RB |
| TC-TEN-009 | Agency base domain: workspace subdomains resolve; fallback platform host redirects to canonical | I,E | FR-TEN-009 | |
| TC-RBAC-001 | Invitation create/accept/expire/revoke/reuse/wrong-email; admin cannot invite admin | I,E | FR-RBAC-001 | RB |
| TC-RBAC-002 | Role × permission matrix | U | FR-RBAC-002 | RB |
| TC-RBAC-003 | Role change guards; last owner; removal with reassignment; immediate access loss | U,I | FR-RBAC-003 | RB |
| TC-RBAC-004 | Member own-only: list/detail/search/kanban/dashboard/report/export/notifications return only own records; others' URLs 404; duplicate warnings reveal existence only; reassignment revokes access; viewer read-only | I,E | FR-RBAC-004 | RB |
| TC-RBAC-005 | Ownership transfer atomic with reauth | I | FR-RBAC-007 | |
| TC-REC-001 | Soft delete hides everywhere; restore; purge after 30 d (fake clock) | I,E | FR-REC-001 | |
| TC-REC-002 | Tag limits, normalization, tag filter | U,I | FR-REC-002 | |
| TC-COM-001 | Company CRUD + validation + audit | I,E | FR-COM-001 | RB |
| TC-COM-002 | Company detail sections load independently; failure isolation | C,E | FR-COM-002 | |
| TC-COM-003 | Duplicate domain warning tenant-scoped | I | FR-COM-003 | |
| TC-CON-001 | Contact CRUD + validation (required, email, phone) + audit | I,E | FR-CON-001 | RB |
| TC-CON-002 | Company association and system activity | I | FR-CON-002 | |
| TC-CON-003 | Duplicate email warning (case-insensitive, tenant-scoped) | I | FR-CON-003 | |
| TC-CON-004 | Lifecycle changes logged; deal won → customer prompt | I,E | FR-CON-004 | |
| TC-LEAD-001 | Lead CRUD; cannot set converted manually | I | FR-LEAD-001 | RB |
| TC-LEAD-002 | Conversion atomic; failure injection leaves no partial writes; double-convert prevented | I,E | FR-LEAD-002 | RB |
| TC-LEAD-003 | Assignment + notification | I | FR-LEAD-003 | |
| TC-DEAL-001 | Deal CRUD; integer money; currency formatting | U,I,E | FR-DEAL-001 | RB |
| TC-DEAL-002 | Stage add/rename/reorder/remove with migration job | I | FR-DEAL-002 | |
| TC-DEAL-003 | Kanban drag + keyboard "Move to stage"; optimistic rollback | E | FR-DEAL-003 | |
| TC-DEAL-004 | Lost reason required; stage history activities; reopen Manager+ | I | FR-DEAL-004 | |
| TC-TASK-001 | Task CRUD; complete writes activity | I,E | FR-TASK-001 | RB |
| TC-TASK-002 | My tasks grouping across timezones (DST edge) | U,E | FR-TASK-002 | |
| TC-TASK-003 | Reminder once at due time (fake clock); idempotent | I | FR-TASK-003 | |
| TC-ACT-001 | Activity logging; timeline order; pagination | I,E | FR-ACT-001 | RB |
| TC-ACT-002 | System activities on events | I | FR-ACT-002 | |
| TC-DASH-001 | KPI values equal fixture expectations; widget failure isolation | I,E | FR-DASH-001 | |
| TC-DASH-002 | Role-scoped dashboard defaults | I | FR-DASH-002 | |
| TC-SRCH-001 | Prefix search across entities, tenant-scoped, non-deleted, rate-limited | U,I,E | FR-SRCH-001 | |
| TC-SRCH-002 | Filters/sorts allowlisted; cursor pagination no dupes/gaps; tampered cursor rejected; URL state | U,I,E | FR-SRCH-002 | RB |
| TC-RPT-001 | Report calculations vs fixtures in tenant timezone; table alternative | I,E | FR-RPT-001 | |
| TC-RPT-002 | Report export permission + CSV sanitization | I | FR-RPT-002 | |
| TC-NOTF-001 | In-app notifications: own only; mark read; polling | I,E | FR-NOTF-001 | |
| TC-NOTF-002 | Email notification preferences honored; unsubscribe token | I | FR-NOTF-002 | |
| TC-IMP-001 | CSV import: limits, mapping, validation preview, dedupe modes, error report, resumable chunks | I,E | FR-IMP-001, NFR-SEC-009 | |
| TC-IMP-002 | CSV export: filters respected, formula injection neutralized, audit | U,I,E | FR-IMP-002 | |
| TC-BRAND-001 | Logo upload: type sniffing, size/dimension limits, SVG rejected, re-encode, content-hash URL | I,E | FR-BRAND-001, NFR-SEC-009 | RB |
| TC-BRAND-002 | Color contrast derivation & blocking | U,C | FR-BRAND-002 | |
| TC-BRAND-003 | Branded email rendering; variables escaped; no tenant HTML | U,I | FR-BRAND-003, FR-BRAND-005 | |
| TC-BRAND-004 | Powered-by toggle per entitlement | I | FR-BRAND-004 | |
| TC-SET-001 | Tenant settings validation (IANA, ISO) + effect on formatting | U,I | FR-SET-001 | |
| TC-SET-002 | Profile & preferences | I,E | FR-SET-002 | |
| TC-PLAN-001 | Seat/record limits enforced server-side in transaction; trial read-only | I | FR-PLAN-001 | |
| TC-PLAN-002 | Usage counters, warnings at 80/100%, nightly reconciliation | I | FR-PLAN-002 | |
| TC-PLAN-003 | Config inheritance & flag resolution (platform → plan → agency → workspace → billing state) | U | FR-PLAN-004 | |
| TC-AGY-001 | Agency provisioning, owner invite, lifecycle, suspension cascade | I,E | FR-AGY-001 | RB |
| TC-AGY-002 | Agency staff roles matrix; agency context cannot read CRM subcollections (type + runtime); CRM access only via flagged membership | U,I | FR-AGY-002 | RB |
| TC-AGY-003 | Cross-agency isolation for every agency action (registry-driven) | I,E | FR-AGY-003 | RB |
| TC-AGY-004 | Branding inheritance & `allowWorkspaceBranding` gate; propagation ≤ 60 s | U,I | FR-AGY-004 | |
| TC-AGY-005 | Agency console lists/filters only own workspaces with correct metadata; accessible/responsive | E | FR-AGY-005 | |
| TC-AGY-006 | Agency usage report aggregates only; no CRM content in export | I | FR-AGY-006 | |
| TC-BILL-001 | Gateway adapter contract suite (Razorpay, PayPal, Stripe) vs mocks on PR and sandboxes nightly; credentials write-only; plan price validation | I | FR-BILL-001 | |
| TC-BILL-002 | Subscription state machine: trialing → active → past_due → read_only → active/cancelled; entitlements change only after verified event; read-only blocks mutations | U,I,E | FR-BILL-002 | |
| TC-BILL-003 | Webhooks: bad signature, wrong agency secret, replay, out-of-order, forged amount/plan in payload → no state change; duplicates idempotent; reconciliation fixes drift | I | FR-BILL-003, NFR-SEC-011 | RB |
| TC-BILL-004 | Billing page & history for owner/admin; agency view per workspace; no card data | E | FR-BILL-004 | |
| TC-BILL-005 | Manual billing: paid-until expiry → past_due/read-only; audit | I | FR-BILL-005 | |
| TC-AUD-001 | Audit entry for every listed event type with required fields; no PII values | I | FR-AUD-001 | RB |
| TC-AUD-002 | Audit viewer admin-only; filters; export entitlement | I,E | FR-AUD-002 | |
| TC-AUD-003 | No code path updates/deletes audit; client denied | I,R | FR-AUD-003 | RB |
| TC-PRIV-001 | Contact DSAR export completeness | I | FR-PRIV-001 | |
| TC-PRIV-002 | Erasure: hard delete, redaction, erasure log, bypass trash | I | FR-PRIV-002 | RB |
| TC-PRIV-003 | Account deletion; sole owner blocked; records reassigned | I,E | FR-PRIV-003 | |
| TC-PRIV-004 | Firestore location matches approved region in all envs (config check) | M | NFR-PRIV-001 | |
| TC-PUB-001 | Marketing pages render, links valid, forms accessible | E | FR-PUB-001 | |
| TC-PUB-002 | Docs/FAQ render; FAQPage JSON-LD matches visible content | E | FR-PUB-002 | |
| TC-PUB-003 | Tenant login branded; noindex; no member info; no OG leakage | E | FR-PUB-003 | |
| TC-SEC-001 | Cross-tenant IDOR on every entity × operation | I,E | NFR-SEC-001 | RB |
| TC-SEC-002 | Payload `tenantId`/`role`/`ownerUid` injection rejected | I | NFR-SEC-002 | RB |
| TC-SEC-003 | Rules deny all client access (all paths, forged claims) | R | NFR-SEC-003 | RB |
| TC-SEC-004 | Privilege escalation: every action × disallowed role; unwrapped-action lint | U,I | NFR-SEC-002 | RB |
| TC-SEC-005 | Schema fuzzing (boundaries, types, oversize, unicode) | U,I | NFR-SEC-004 | RB |
| TC-SEC-006 | Security headers & CSP on all route classes | E | NFR-SEC-005 | RB |
| TC-SEC-007 | Rate limits return 429 + Retry-After; fail-closed behavior | I | NFR-SEC-006 | |
| TC-SEC-008 | Secret scan + client bundle scan for server env names/keys | N | NFR-SEC-007 | RB |
| TC-SEC-009 | Dependency audit gate | N | NFR-SEC-008 | RB |
| TC-SEC-010 | XSS payload corpus inert in all text fields, Markdown, branding, emails | C,E | NFR-SEC-004, FR-ACT-001 | RB |
| TC-SEC-011 | CSRF: cross-origin POSTs to actions/handlers rejected | I,E | NFR-SEC-005 | RB |
| TC-SEC-012 | Reference smuggling + search/report/export/notification cross-tenant leakage | I,E | NFR-SEC-001 | RB |
| TC-SEC-013 | No cross-tenant caching; `Cache-Control: private, no-store` on authed responses | I,E | NFR-SEC-001 | RB |
| TC-SEC-014 | TLS/HSTS config on all hosts (staging/prod) | N | NFR-SEC-010 | |
| TC-SEC-015 | Suspended/deleted workspace or agency and removed member sessions blocked | I,E | NFR-SEC-001, FR-TEN-002 | RB |
| TC-SEC-016 | No card/bank data: checkout is redirect-only; request/log/storage scanners find no PAN patterns; gateway payloads not logged | I,N | NFR-SEC-011 | RB |
| TC-PERF-001 | Lighthouse CI budgets & bundle sizes | N | NFR-PERF-001, NFR-PERF-003 | |
| TC-PERF-002 | k6 load: p95 latencies at A-06 load | N | NFR-PERF-002 | |
| TC-A11Y-001 | axe scan of all routes (themes, brands) | E | NFR-A11Y-001 | RB |
| TC-A11Y-002 | Keyboard-only journeys | E | NFR-A11Y-001 | RB |
| TC-A11Y-003 | Screen reader manual checklist | M | NFR-A11Y-001 | |
| TC-RESP-001 | Viewport matrix journeys, no overflow | E | NFR-RESP-001 | RB |
| TC-VIS-001 | Visual regression | E | NFR-RESP-001 | |
| TC-SEO-001 | Index policy per host; sitemap only public; no private metadata | E | NFR-SEO-001 | RB |
| TC-SEO-002 | Metadata/canonical/OG/JSON-LD validity on public pages | E | NFR-SEO-002 | |
| TC-REL-001 | Backup/PITR restore drill within RTO; erasure re-application | M | NFR-REL-002 | RB |
| TC-REL-002 | Uptime checks & alerts fire (synthetic failure) | M | NFR-REL-001 | |
| TC-OBS-001 | Logs include requestId/tenantId/uid; PII redaction tests | U,I | NFR-OBS-001 | |
| TC-MAINT-001 | CI gates enforced (branch protection, required checks, coverage thresholds) | N | NFR-MAINT-001 | |
| TC-COST-001 | Read-count budget per view (instrumented repository counter in integration tests) | I | NFR-COST-001 | |
| TC-I18N-001 | No hard-coded user-facing strings (lint); Intl formatting per locale | U | NFR-I18N-001 | |

## 13. Test data, fixtures, cleanup, and CI execution

- **Factories** (`packages/testing/factories`) build valid entities with overrides; **scenarios** compose agencies (Agency One: Acme, Globex; Agency Two: Initech; Agency Three: suspended with Umbrella) with all workspace roles, two Members with disjoint records, agency staff (Priya, Tom), platform staff, and ~50 records per workspace; **gateway mocks** (`packages/testing/gateways`) produce correctly and incorrectly signed webhook fixtures per provider; **Vercel Domains API mock** simulates verification states; a **large scenario** (100k contacts) is generated only for perf tests in staging.
- All fixture data is fictional (`*.example` domains, 555/Ofcom drama phone ranges).
- Emulator state: `beforeEach` clears Firestore via emulator REST endpoint (`DELETE /emulator/v1/projects/{id}/databases/(default)/documents`) and Auth accounts; parallel workers use distinct project IDs (`demo-crm-w{n}`) for isolation.
- E2E uses fresh seeded state per spec file; tests never depend on order.
- No production data in any test environment; staging UAT uses synthetic or consented pilot data.
- CI execution: see [10 §2](10-ci-cd-and-deployment.md#2-continuous-integration-and-quality-gates) — unit/integration/rules on every PR (~10 min target), E2E smoke + affected on PR, full E2E/visual/a11y nightly and pre-release; Playwright sharding (4 shards); artifacts: traces, screenshots, coverage, Lighthouse reports.
- Flaky policy: auto-retry once in CI (reported); quarantine via tagged skip with issue and 7-day expiry ([08 §11](08-ai-agentic-development-workflow.md#11-failure-recovery-and-rollback)).

### Pass/fail criteria
- **Pass:** all RB tests green; coverage thresholds met; no new serious/critical a11y violations; budgets met; no High security alerts.
- **Fail:** any RB failure, threshold miss, or untriaged regression → merge/release blocked.
