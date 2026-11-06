# 00 — Project Overview

> **Document set:** White-Label Multi-Tenant CRM — Planning Phase
> **Status:** Draft v1.1 for approval (revised with owner answers of 2026-10-09) · **Owner:** Product/Architecture
> **Next:** [01 Product Requirements](01-product-requirements.md)

## Revision history

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-10-09 | Initial plan |
| 1.1 | 2026-10-09 | Owner answers applied: agency (reseller) hierarchy; custom domains at launch; operator-provisioned workspaces (no public signup); payment gateways at launch (Razorpay primary, PayPal, Stripe); Vercel hosting; Members see only their own records; MFA/Identity Platform deferred; US region for development; multi-instance deployment model |

## Document Map

| # | File | Purpose |
|---|------|---------|
| 00 | [00-project-overview.md](00-project-overview.md) | Vision, scope, roles, requirement index, assumptions, risks, open questions |
| 01 | [01-product-requirements.md](01-product-requirements.md) | Detailed functional requirements + acceptance criteria |
| 02 | [02-system-architecture.md](02-system-architecture.md) | Next.js + Firebase architecture, ADRs, data flows |
| 03 | [03-database-schema.md](03-database-schema.md) | Firestore collections, indexes, query patterns, retention |
| 04 | [04-security-and-compliance.md](04-security-and-compliance.md) | Threat model, authn/authz, rules, privacy, release-blocking vulns |
| 05 | [05-white-label-and-multi-tenancy.md](05-white-label-and-multi-tenancy.md) | Agencies, workspaces, provisioning, branding, domains, isolation, entitlements |
| 06 | [06-ui-ux-and-responsive-design.md](06-ui-ux-and-responsive-design.md) | Design system, responsive behavior, WCAG 2.2 AA |
| 07 | [07-seo-aeo-and-performance.md](07-seo-aeo-and-performance.md) | Public SEO/AEO, index policy, Core Web Vitals, budgets |
| 08 | [08-ai-agentic-development-workflow.md](08-ai-agentic-development-workflow.md) | Agent roles, task protocol, approvals, recovery |
| 09 | [09-testing-and-quality-assurance.md](09-testing-and-quality-assurance.md) | Test strategy, test catalog (TC-IDs), release-blocking tests |
| 10 | [10-ci-cd-and-deployment.md](10-ci-cd-and-deployment.md) | Branching, pipelines, environments, instances, rollback, incidents |
| 11 | [11-implementation-roadmap.md](11-implementation-roadmap.md) | 12 phases, task IDs (T-IDs), dependencies |
| 12 | [12-environment-and-configuration.md](12-environment-and-configuration.md) | Tooling, env vars, emulators, onboarding |
| 13 | [13-release-readiness-checklist.md](13-release-readiness-checklist.md) | Go/no-go checklist and blockers |
| 14 | [14-traceability-matrix.md](14-traceability-matrix.md) | Requirement → component → task → test → acceptance |

### Labels used across all documents

| Label | Meaning |
|-------|---------|
| **[CONFIRMED]** | Stated explicitly by the project owner (brief or answers). Not to be changed without owner approval. |
| **[PROPOSED]** | Recommendation by the planning team. Becomes binding once the plan is approved (see [11 Phase 0](11-implementation-roadmap.md#phase-0--requirements-validation-and-architecture-approval)). |
| **[ASSUMPTION]** | Working assumption used to proceed. Each has an ID (A-xx) and must be validated. |
| **[OPEN]** | Unresolved question requiring owner input. Each has an ID (OQ-xx). |

### ID conventions (used in every document)

| Prefix | Example | Defined in |
|--------|---------|-----------|
| `FR-<AREA>-NNN` | FR-AUTH-001 | Functional requirement — [01](01-product-requirements.md) |
| `NFR-<AREA>-NNN` | NFR-SEC-001 | Non-functional requirement — this doc, §7 |
| `ADR-NNN` | ADR-004 | Architecture decision — [02](02-system-architecture.md#10-architecture-decision-records) |
| `T-PP-NN` | T-03-02 | Implementation task (phase PP) — [11](11-implementation-roadmap.md) |
| `TC-<AREA>-NNN` | TC-SEC-001 | Test case — [09](09-testing-and-quality-assurance.md#12-test-case-catalog) |
| `A-NN`, `R-NN`, `OQ-NN` | OQ-01 | Assumption, risk, open question — this doc |

Priority scale: **P0** = MVP, release-blocking · **P1** = MVP, high · **P2** = MVP, should-have (may slip to fast-follow with owner approval) · **P3** = post-MVP (later enhancement).

### Terminology

| Term | Meaning |
|------|---------|
| **Operator / platform** | The company that builds and runs this software (the project owner). |
| **Instance** | One independent deployment of the codebase: its own Firebase/GCP project, Vercel project, region, domains and payment-gateway configuration ([02 §11](02-system-architecture.md#11-environments-and-instances)). |
| **Agency** | A reseller customer of the operator. Rebrands the CRM and sells it to its own clients. |
| **Workspace (tenant)** | One client business's isolated CRM space. Every workspace belongs to exactly one agency. In code and IDs "tenant" = workspace. |

---

## 1. Vision

Build a **secure, multi-tenant, white-label CRM** that the operator offers to **agencies**, who rebrand it and resell it to **their own client businesses**. Each client receives an isolated workspace that looks and feels like the agency's product (name, logo, colors, custom domain, branded emails), while the operator runs one codebase and deploys it as one or more instances.

**Vision statement:** *"A fast, accessible, trustworthy CRM that any agency can brand and resell as its own — with data isolation strong enough that nobody has to think about it."*

## 2. Goals

| ID | Goal | Measure |
|----|------|---------|
| G-1 | Strict isolation between workspaces **and** between agencies | Zero cross-workspace or cross-agency data exposure in automated isolation suites (TC-SEC-001, TC-SEC-012, TC-SEC-013, TC-AGY-003) and in pentest |
| G-2 | Fast onboarding | Operator provisions an agency and its first client workspace with custom domain in < 30 minutes (excluding DNS propagation); client owner accepts invite and creates a first deal in < 15 minutes (UAT-timed) |
| G-3 | Core sales workflow | Leads → contacts/companies → deals → won, with tasks and activities, all functional on mobile and desktop |
| G-4 | Operability | One-command local setup with emulators; CI gates on every PR; documented rollback; repeatable instance setup |
| G-5 | Accessibility & performance | WCAG 2.2 AA on all MVP flows; Core Web Vitals "good" at p75 on public pages |
| G-6 | AI-agentic delivery | Every task traceable from requirement to test; no security control weakened without human approval |
| G-7 | Monetization at launch | Agencies can collect subscription payments from client workspaces through Razorpay (PayPal and Stripe as additional gateways) |

## 3. Scope

### 3.1 MVP (in scope)

- **[CONFIRMED]** Agency (reseller) → client workspace hierarchy; agency console for agency staff.
- **[CONFIRMED]** Workspaces created by the operator (and optionally entitled agency admins) — **no public self-service signup**.
- **[CONFIRMED]** Custom domains at launch (per workspace), plus subdomains of an agency domain or of the platform domain.
- **[CONFIRMED]** Payment gateways at launch: Razorpay (primary), PayPal, Stripe — gateway chosen per agency.
- **[CONFIRMED]** Members (sales reps) see only their own records.
- **[CONFIRMED]** Vercel hosting.
- Authentication: email/password, Google sign-in, email verification, password reset, server session cookies, account creation only via invitation, privileged-account protections (MFA deferred).
- Workspace provisioning, suspension, deletion, full export.
- Team: invitations, five built-in workspace roles, role changes, removal, ownership transfer; agency staff roles.
- CRM modules: companies, contacts (incl. customer lifecycle stage), leads (with conversion), deals (single configurable pipeline, kanban), tasks, activities/timeline, tags, soft delete with restore.
- Dashboard KPIs, global prefix search, list filtering/sorting/cursor pagination, standard reports.
- In-app + email notifications, task reminders.
- CSV import (contacts, companies, leads) and CSV export.
- White-label: logo, favicon, app name, brand colors (contrast-safe) with agency → workspace inheritance, branded transactional emails, agency sender domain (P2), "powered by" toggle per plan.
- Plans & entitlements, feature flags, usage counters, subscriptions and payment history.
- Audit log (append-only) with admin viewer.
- Privacy: contact data export & erasure, user account deletion.
- Public operator marketing site + docs/FAQ with technical SEO and AEO.

### 3.2 Post-MVP (later enhancements, P3)

MFA for all privileged and tenant users (needs Identity Platform, OQ-10) · enterprise SSO (SAML/OIDC) · teams/groups · custom roles · custom fields · web-to-lead forms · multiple pipelines · recurring tasks · sending email from CRM · Gmail/Outlook sync · saved views · full-text search engine · custom report builder · web push · migration importers from other CRMs · white-labelled agency console on the agency's own domain · operator-to-agency automated billing · mobile native apps · public API & webhooks · AI features (summaries, lead scoring).

### 3.3 Explicitly out of scope

Marketing automation (campaigns/sequences), telephony/dialer, quoting/invoicing for CRM deals, agency-branded public marketing websites, storing card data (hosted checkout only), HIPAA-regulated data, on-premise deployment, offline-first editing.

## 4. Success Criteria (MVP launch)

1. All P0 requirements implemented with passing release-blocking tests ([09 §11](09-testing-and-quality-assurance.md#11-release-blocking-tests)).
2. Release-readiness checklist fully green ([13](13-release-readiness-checklist.md)).
3. No open Critical/High security findings ([04 §15](04-security-and-compliance.md#15-release-blocking-vulnerabilities)).
4. UAT sign-off by ≥ 1 pilot agency with ≥ 3 client workspaces on staging, including one custom domain and one live-mode-equivalent Razorpay test subscription.
5. Backup restore drill completed within RTO ([10 §9](10-ci-cd-and-deployment.md#9-backups-and-disaster-recovery)).

## 5. Users, Roles, and Use Cases

### 5.1 Actors

| Actor | Description | Scope |
|-------|-------------|-------|
| **Platform Super Admin** | Operator staff: provisions agencies and workspaces, plans, gateways, domains, suspension. Protected by FR-AUTH-008 (MFA deferred). | Instance (console host) |
| **Platform Support** | Operator staff with read-only agency/workspace metadata; **no** access to workspace CRM records. | Instance |
| **Agency Owner** | Primary account of a reselling agency; manages agency staff, branding defaults, domains, billing settings, client workspaces. | One agency |
| **Agency Admin** | Manages the agency's client workspaces (status, plan, branding, owner invitations). No access to workspace CRM records unless separately invited into that workspace (OQ-21). | One agency |
| **Workspace Owner** | Client business's primary account. Subscription, branding (if allowed by agency), deletion, all data. | One workspace |
| **Workspace Admin** | Manages users, settings, branding, imports, audit log. Cannot delete workspace or transfer ownership. | One workspace |
| **Manager** | Full CRUD on all CRM records, reports, export. No user/settings management. | One workspace |
| **Member (Sales Rep)** | **[CONFIRMED]** Sees, edits and reports on **only records they own** (and tasks assigned to them). | One workspace |
| **Viewer** | Read-only access to all CRM records and dashboards of the workspace. | One workspace |
| **Anonymous visitor** | Reads public marketing/docs pages; can request a demo. Cannot sign up. | Public |

The full permission matrix is in [01 §4.3](01-product-requirements.md#43-permission-matrix).

### 5.2 Primary use cases

| ID | Use case | Actor |
|----|----------|-------|
| UC-01 | Provision an agency, its domain, gateway and branding defaults | Platform Super Admin |
| UC-02 | Provision a client workspace with custom domain and invite its owner | Platform Super Admin / entitled Agency Admin |
| UC-03 | Accept invitation, set up account, brand workspace (if allowed), invite teammates | Workspace Owner/Admin |
| UC-04 | Capture a lead, qualify it, convert to contact + company + deal | Member |
| UC-05 | Move deals through pipeline stages and close won/lost | Member/Manager |
| UC-06 | Plan and complete follow-up tasks; get reminders | Member |
| UC-07 | Log calls/meetings/notes and review a customer timeline | Member |
| UC-08 | Review pipeline dashboard and standard reports | Manager |
| UC-09 | Import existing contacts from CSV; export lists | Admin/Manager |
| UC-10 | Subscribe a workspace to a plan and pay via the agency's gateway | Workspace Owner |
| UC-11 | Respond to a data-subject request (export/erase a contact) | Workspace Admin |
| UC-12 | Suspend or delete a workspace or agency | Platform Super Admin / Agency Admin (suspend own workspaces) |
| UC-13 | Review audit log after a suspected incident | Owner/Admin, Platform Super Admin |

## 6. Functional Requirement Index

Full detail and acceptance criteria: [01-product-requirements.md](01-product-requirements.md). Areas:

| Area | Code | MVP reqs | Post-MVP reqs |
|------|------|----------|---------------|
| Authentication | AUTH | 001–004, 006, 008 | 005, 007 |
| Workspaces (tenancy) | TEN | 001–009 | — |
| Agencies (resellers) | AGY | 001–006 | — |
| Roles & team | RBAC | 001–004, 007 | 005, 006 |
| Common record behavior | REC | 001, 002 | 003 |
| Companies | COM | 001–003 | — |
| Contacts / customers | CON | 001–004 | — |
| Leads | LEAD | 001–003 | 004 |
| Deals | DEAL | 001–004 | 005 |
| Tasks | TASK | 001–003 | 004 |
| Activities & communication | ACT | 001, 002 | 003, 004 |
| Dashboard | DASH | 001, 002 | — |
| Search/filter/sort | SRCH | 001, 002 | 003, 004 |
| Reporting | RPT | 001, 002 | 003 |
| Notifications | NOTF | 001, 002 | 003 |
| Import/export | IMP | 001, 002 | 003 |
| Branding | BRAND | 001–005 | — |
| Settings | SET | 001, 002 | — |
| Plans & entitlements | PLAN | 001, 002, 004 | (003 retired → BILL) |
| Billing & payments | BILL | 001–005 | — |
| Audit | AUD | 001–003 | — |
| Privacy | PRIV | 001–003 | — |
| Public site | PUB | 001–003 | — |

## 7. Non-Functional Requirements

| ID | Requirement | Priority | Measure / target |
|----|-------------|----------|------------------|
| NFR-SEC-001 | **Isolation**: no user can read, infer, or modify another workspace's data — and no agency staff can access another agency's agencies/workspaces — through any channel (UI, Server Actions, Route Handlers, search, reports, exports, notifications, emails, webhooks, caches, logs). | P0 | Isolation suites 100% pass; pentest no cross-tenant/agency finding |
| NFR-SEC-002 | **Server-side authorization** on every read and mutation. Workspace/agency derived from verified session + host + membership/staff record — never from client payload. Roles/permissions never read from client. Member own-record scope enforced server-side. | P0 | TC-SEC-002, TC-SEC-004, TC-RBAC-004 |
| NFR-SEC-003 | **Firestore & Storage Security Rules default-deny**; client SDK has no direct access to data in MVP. | P0 | Rules tests 100% pass |
| NFR-SEC-004 | **Input validation & output encoding**: all inputs validated by shared Zod schemas on the server; all output escaped by default. | P0 | TC-SEC-005, TC-SEC-010 |
| NFR-SEC-005 | **Secure headers, CSP, CSRF protection** on all responses / mutation endpoints. | P1 | TC-SEC-006, TC-SEC-011 |
| NFR-SEC-006 | **Rate limiting** on auth-adjacent, invitation, import/export, search, webhook, and public form endpoints. | P1 | TC-SEC-007 |
| NFR-SEC-007 | **Secrets management**: secrets (incl. per-agency gateway credentials) only in Google Secret Manager / Vercel encrypted env; none in repo, Firestore plaintext, or client bundle; prefer keyless GCP access from Vercel (OIDC/Workload Identity Federation). | P0 | TC-SEC-008 |
| NFR-SEC-008 | **Dependency hygiene**: no known Critical/High vulnerabilities in production dependencies at release (or documented, approved exception). | P1 | TC-SEC-009 |
| NFR-SEC-009 | **Upload security** for logos and CSV files: allowlisted types, magic-byte sniffing, size limits, image re-encoding, no SVG in MVP. | P1 | TC-BRAND-001, TC-IMP-001 |
| NFR-SEC-010 | **Encryption**: TLS 1.2+ with HSTS in transit (incl. custom domains); provider-managed encryption at rest. | P1 | TC-SEC-014 |
| NFR-SEC-011 | **Payment security / PCI scope minimization**: no card or bank data ever reaches our servers or storage (gateway-hosted checkout only); webhooks verified, idempotent, and reconciled against the gateway API. | P0 | TC-BILL-003, TC-SEC-016 |
| NFR-PERF-001 | Public pages Core Web Vitals at p75: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. | P1 | TC-PERF-001 |
| NFR-PERF-002 | App: server response p95 ≤ 800 ms for list/detail pages, ≤ 500 ms for mutations at target load (A-06). | P1 | TC-PERF-002 |
| NFR-PERF-003 | JS budgets: public route initial JS ≤ 150 KB gzip; app route initial JS ≤ 250 KB gzip. | P2 | TC-PERF-001 |
| NFR-A11Y-001 | WCAG 2.2 Level AA on all MVP screens. | P0 | TC-A11Y-001..003 |
| NFR-RESP-001 | Fully usable from 320 px to ≥ 1920 px width; all MVP flows completable on mobile. | P1 | TC-RESP-001, TC-VIS-001 |
| NFR-REL-001 | Availability target 99.5% monthly (MVP), excluding scheduled maintenance. | P1 | TC-REL-002 |
| NFR-REL-002 | Backups (staging/production instances): PITR enabled (7-day window) + scheduled backups; RPO ≤ 1 h, RTO ≤ 4 h. | P1 | TC-REL-001 |
| NFR-OBS-001 | Structured logs with `requestId`, `agencyId`, `tenantId`, `uid`; no PII values or secrets in logs; error tracking; alerting. | P1 | TC-OBS-001 |
| NFR-MAINT-001 | TypeScript strict, ESLint clean, CI gates, coverage thresholds per [09 §10](09-testing-and-quality-assurance.md#10-coverage-targets). | P1 | TC-MAINT-001 |
| NFR-SEO-001 | Private app, agency, and custom-domain pages never indexed; no tenant data in sitemaps, metadata, or structured data. | P0 | TC-SEO-001 |
| NFR-SEO-002 | Public operator pages have complete metadata, canonical URLs, OG, valid JSON-LD. | P1 | TC-SEO-002 |
| NFR-COST-001 | Firestore reads per page view within budget ([03 §11](03-database-schema.md#11-cost-optimization)); billing alerts configured; development instance stays within free quotas where possible. | P2 | TC-COST-001 |
| NFR-I18N-001 | English-only UI in MVP, but all user-facing strings in a message catalog; locale-aware date/number/currency formatting (incl. INR). | P2 | TC-I18N-001 |
| NFR-PRIV-001 | **[CONFIRMED]** Each instance stores data in one Firestore location chosen per client deployment (immutable after creation). Development instance: **US** (proposed `us-east1`, see [12 §4](12-environment-and-configuration.md#4-firebase-setup)). | P1 | TC-PRIV-004 |

## 8. Assumptions

| ID | Assumption | Impact if wrong |
|----|-----------|-----------------|
| A-01 | **[CONFIRMED → resolved]** Two-level hierarchy: agency → client workspace. No deeper nesting (no sub-agencies). | Recursive hierarchy needed. |
| A-02 | **[CONFIRMED → resolved]** Custom domains are in MVP; agency-domain subdomains and platform subdomains also supported. | — |
| A-03 | **[CONFIRMED → resolved]** No public signup; workspaces created by operator (and entitled agency admins, OQ-22). | — |
| A-04 | **[CONFIRMED → resolved]** Payment gateways at launch; gateway configured per agency. | — |
| A-05 | One currency per workspace (workspace default) for deal amounts in MVP. | Multi-currency reporting needs FX rates (OQ-08). |
| A-06 | Scale per instance at MVP: ≤ 20 agencies, ≤ 500 workspaces, ≤ 50 users/workspace, ≤ 100k contacts/workspace, ≤ 200 concurrent users. | Search strategy, sharding, cost model change (OQ-15). |
| A-07 | English-only UI at launch. | Translation pipeline needed (OQ-14). |
| A-08 | Source control and CI on **GitHub** (GitHub Actions); Vercel Git integration for previews. | CI syntax changes; concepts unchanged (OQ-17). |
| A-09 | Operator and agency staff do **not** read workspace CRM records unless invited into that workspace as members (audited). | Requires break-glass design (OQ-18, OQ-21). |
| A-10 | Workspaces do not store special-category data (health, biometrics, government IDs); prohibited in Terms. | Field-level encryption and stricter compliance needed (OQ-12). |
| A-11 | Placeholder domains in docs: operator marketing `www.example.com`; platform workspace subdomains `{slug}.app.example.com`; agency console `partners.example.com`; platform console `console.example.com`; brand assets `assets.example.com`; agency domain example `crm.agency-one.example`; client custom domain example `crm.acme.example`. | Replace once domains chosen (OQ-16). |
| A-12 | **Instance model:** the codebase is deployed as one or more independent instances. A shared instance hosts many agencies; a dedicated instance is created when a client needs a specific region or isolation. Data never crosses instances. | If every agency always gets its own instance, agency-isolation logic remains but is less critical; ops cost grows per instance (OQ-19). |
| A-13 | **Merchant of record:** each agency collects payments from its own client workspaces using the agency's own gateway account; the operator invoices agencies outside the application in MVP. | If the operator collects all payments, gateway config becomes per-instance and payouts/marketplace features are needed (OQ-20). |
| A-14 | Development instance runs on the Firebase **Blaze** plan with a low budget alert, because Cloud Functions and new Cloud Storage buckets require Blaze (verify); free-tier quotas still apply to usage. | If Spark-only is mandatory, background jobs must move to Vercel Cron and Storage must be replaced (major change). |

## 9. Constraints

- **[CONFIRMED]** Next.js (App Router, TypeScript), Firebase Authentication, Cloud Firestore, Vercel hosting.
- Firestore constraints shape the design: no joins, no native full-text search, composite indexes required for multi-field queries, 1 MiB document limit, ~1 sustained write/sec guidance per document, offset pagination bills skipped reads, location immutable. See [03 §10](03-database-schema.md#10-firestore-limitations-and-design-responses).
- Firebase Admin SDK **bypasses** Security Rules; therefore server authorization code is the primary enforcement point (see [04 §5](04-security-and-compliance.md#5-authorization-model)).
- Hosting (Vercel) and data (Google Cloud) are in different clouds: credentials federation, region pairing and egress latency must be managed ([02 §5](02-system-architecture.md#5-firestore-and-admin-sdk-integration)).
- MFA is unavailable until Identity Platform is adopted ([CONFIRMED] deferred).
- Planning only in this phase: no application code, packages, or configuration.

## 10. Risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|----|------|-----------|--------|-----------|-------|
| R-01 | A missed authorization check in a Server Action exposes cross-workspace/agency data (Admin SDK bypasses rules). | Med | Critical | Single action wrappers + scoped repositories; lint rule banning raw Firestore access in features; registry-driven isolation tests; security review gate. | Security agent |
| R-02 | Firebase Auth requires every custom domain/subdomain to be an authorized domain (OAuth, email action continue URLs). Many custom domains → many entries, possible limits. | High | Med | Add domain to authorized domains via API during domain onboarding (verify API + limits in T-01-09); email/password as baseline; Google sign-in only where domain authorized. | Architect |
| R-03 | Firestore lacks full-text search; prefix token search may disappoint users. | Med | Med | Clear UX for prefix search; ADR-010 escape hatch to external search engine. | Architect |
| R-04 | Composite-index explosion (filter combinations × Member own-scope variants). | Med | Med | Allowlisted filter combos; indexes in code; CI index-coverage check. | Backend |
| R-05 | Next.js / Vercel caching (Data Cache, `use cache`, CDN) serves one workspace's response to another. | Low | Critical | Authenticated routes dynamic + `Cache-Control: private, no-store`; tenantId in every cache key; TC-SEC-013. | Security agent |
| R-06 | Per-request membership/tenant reads across clouds (Vercel → Firestore) increase latency and cost. | Med | Med | Pair Vercel function region with Firestore region; request-scoped memoization; short-TTL config cache; budgets in NFR-COST-001. | Backend |
| R-07 | Hot documents (usage counters) exceed write-rate guidance during imports. | Med | Low | Batch increments per chunk; sharded counters if needed. | Backend |
| R-08 | AI agents silently weaken security (e.g., broaden rules, skip checks). | Med | High | Protected-file list, mandatory security review, human checkpoints ([08 §8](08-ai-agentic-development-workflow.md#8-guardrails-protected-areas-and-prohibited-actions)). | Lead |
| R-09 | Erased personal data persists in backups. | High | Med | Documented backup retention ≤ 14 weeks; disclosure; restore procedure re-applies erasure log. | Security |
| R-10 | Vercel platform gaps: custom-domain count/plan limits, wildcard domains requiring Vercel nameservers, OIDC federation to GCP setup. | Med | Med | Verify in T-01-09 spike; documented fallbacks (CNAME-only custom domains; encrypted service-account key with rotation). | DevOps |
| R-11 | Email deliverability problems for branded and agency-domain emails. | Med | Med | Reputable provider, SPF/DKIM/DMARC, per-agency sender domain verification, bounce handling. | DevOps |
| R-12 | Scope creep beyond MVP (agency + billing + domains already enlarge MVP). | High | Med | MVP list frozen at Phase 0; changes via change request. | Product |
| R-13 | Abuse via branded emails (phishing) by a malicious agency or workspace. | Low | High | No public signup; restricted template customization; suspension kill-switch at agency and workspace level. | Security |
| R-14 | Payment webhook forgery, replay, or out-of-order events grant entitlements without payment. | Med | High | Signature verification per gateway, event idempotency, re-fetch state from gateway API, never trust amounts in payloads (TC-BILL-003). | Security |
| R-15 | **Privileged accounts without MFA** (platform/agency admins) are phished or credential-stuffed. | Med | Critical | FR-AUTH-008 compensating controls (Google Workspace sign-in with org-enforced 2-Step Verification for platform staff, short sessions, re-auth, login alerts, IP allowlist on console, rate limits); adopt MFA as soon as Identity Platform is approved. | Security |
| R-16 | Per-agency secrets (gateway keys, webhook secrets) sprawl or leak. | Med | High | Secret Manager per-agency secrets with naming convention, least-privilege access, rotation runbook; secrets never shown back in UI after entry. | Security |
| R-17 | Regulatory scope widens with Indian clients (Razorpay primary): India DPDP Act 2023, RBI payment rules; region requirements per client. | Med | Med | Legal review (OQ-12); per-instance region (A-12); no card data stored. | Product/Legal |
| R-18 | Multiple instances drift in version/config. | Med | Med | Single release pipeline deploying to all instances from the same tag; instance registry; config validation at boot. | DevOps |

## 11. Open Questions

### 11.1 Answered (2026-10-09)

| ID | Question | Owner answer | Resulting decision |
|----|----------|-------------|--------------------|
| OQ-01 | Routing: subdomains, paths, or custom domains at launch? | Custom domains at launch; subdomains possibly | Custom domains P1 in MVP; platform and agency-domain subdomains supported (FR-TEN-005, FR-TEN-009) |
| OQ-02 | Self-service signup? | Operator creates every workspace during setup | No public signup; invite-only account creation (FR-TEN-001, FR-AUTH-001) |
| OQ-03 | Billing at launch? | Gateway differs per client; Razorpay primary, PayPal, Stripe | Gateway abstraction; Razorpay P1, PayPal/Stripe P2 (FR-BILL-*); FR-PLAN-003 retired |
| OQ-04 | Firestore region? | Depends on client deployments; US for development | Region per instance; dev instance in US (NFR-PRIV-001, A-12) |
| OQ-05 | Hosting? | Vercel | ADR-007 revised |
| OQ-09 | Member record visibility? | Only their own | Own-scope enforced in repositories and indexes (FR-RBAC-004, ADR-023) |
| OQ-10 | Identity Platform / MFA? | Not now; later | FR-AUTH-005 → P3; compensating controls FR-AUTH-008 |
| OQ-13 | Agencies reselling to clients? | Yes | Agency hierarchy (FR-AGY-*, ADR-020) |

### 11.2 Still open

| ID | Question | Default if unanswered | Impact |
|----|----------|----------------------|--------|
| OQ-06 | Transactional email provider (Postmark, Resend, SendGrid, Amazon SES)? Must support per-agency sender domains. | **Answered 2026-10-10: Resend**, integrated later — Phase 5 ships the provider-agnostic interface + branded templates with the console provider; Resend adapter and sender domains (T-05-08) follow | Cost, deliverability, DKIM per agency |
| OQ-07 | Rate-limit store: Upstash Redis (Vercel Marketplace) or other? | Upstash Redis (ADR-013) | Vendor count, latency, cost |
| OQ-08 | Multi-currency deals needed? | No (A-05) | Reporting complexity |
| OQ-11 | Error tracking: Sentry or Google Cloud Error Reporting only? | Sentry (works on Vercel) with PII scrubbing | Vendor/PII review |
| OQ-12 | Compliance targets: GDPR, India DPDP Act, CCPA, SOC 2 timeline? | GDPR + DPDP + CCPA readiness; SOC 2 later | Controls, documentation, DPAs |
| OQ-14 | Languages required at launch? | English only | i18n pipeline |
| OQ-15 | Expected scale at 12 months (agencies, workspaces, users)? | A-06 | Search engine, sharding, instance count, cost |
| OQ-16 | Platform brand name and domains? | Placeholders (A-11) | DNS, certificates, email |
| OQ-17 | Git hosting / CI vendor? | GitHub / GitHub Actions | CI config |
| OQ-18 | May operator support staff view workspace data (impersonation) with consent? | No in MVP | Break-glass design, audit |
| OQ-19 | **Instance model:** shared multi-agency instance by default with dedicated instances on demand — or one instance per agency always? | Shared by default + dedicated on demand (A-12) | Ops cost, isolation strength, release process |
| OQ-20 | **Merchant of record:** does each agency collect from its clients with its own gateway account, or does the operator collect everything? | Agency's own gateway account; operator invoices agencies offline (A-13) | Gateway config location, payouts, tax handling |
| OQ-21 | Can agency staff open their clients' workspaces and see CRM data? | No — only if invited as a workspace member; audited | Privacy promises to clients, roles |
| OQ-22 | Can agency admins create client workspaces themselves, or only the operator? | Operator only by default; per-agency entitlement `agency.canProvisionWorkspaces` can enable it | Agency autonomy vs operator control |
| OQ-23 | Must the agency console itself be white-labelled on the agency's domain at launch? | No — operator-branded `partners.example.com` | Domain/auth work for console |
| OQ-24 | First production client regions (e.g., India `asia-south1`, US, EU)? | Decide per instance before its creation | Latency, residency, Vercel region pairing |
| OQ-25 | Which plans/prices does each agency sell, and can agencies define their own plans and prices? | Operator defines plan templates; agencies set prices per plan in their gateway currency | Plan model, gateway plan IDs |
| OQ-26 | CSV imports allow 10 MB (FR-IMP-001), but Vercel Functions accept request bodies up to 4.5 MB. Lower the limit to 4 MB, or upload directly to Cloud Storage with a signed, size-capped URL? | Signed direct upload (keeps 10 MB; one more step in the import flow) — found in T-09-01 (F-08) | Import UX, storage IAM, upload validation |

## 12. Related documents

Requirements detail → [01](01-product-requirements.md) · Architecture → [02](02-system-architecture.md) · Roadmap → [11](11-implementation-roadmap.md) · Traceability → [14](14-traceability-matrix.md)
