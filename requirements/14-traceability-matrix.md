# 14 — Traceability Matrix

> **Prev:** [13 Release Readiness](13-release-readiness-checklist.md) · **Start:** [00 Overview](00-project-overview.md)
> v1.1 — adds agencies (AGY), billing (BILL), custom/agency domains, privileged-account controls, Member own-scope; FR-AUTH-005 deferred; FR-PLAN-003 retired.
> Maps every requirement → architecture component → implementation task(s) → test case(s) → acceptance criteria location. Maintained by the Lead/Documentation agent; updated in the same PR that changes any ID ([08 §5](08-ai-agentic-development-workflow.md#5-context-handoff)).

## Contents

1. [ID schemes](#1-id-schemes)
2. [Component legend](#2-component-legend)
3. [Functional requirements](#3-functional-requirements)
4. [Non-functional requirements](#4-non-functional-requirements)
5. [Use cases and goals coverage](#5-use-cases-and-goals-coverage)
6. [Gap analysis](#6-gap-analysis)
7. [Maintenance rules](#7-maintenance-rules)

---

## 1. ID schemes

| Artifact | Format | Source |
|----------|--------|--------|
| Functional requirement | `FR-<AREA>-NNN` | [01](01-product-requirements.md) |
| Non-functional requirement | `NFR-<AREA>-NNN` | [00 §7](00-project-overview.md#7-non-functional-requirements) |
| Task | `T-PP-NN` (PP = phase 00–11) | [11](11-implementation-roadmap.md) |
| Test case | `TC-<AREA>-NNN` | [09 §12](09-testing-and-quality-assurance.md#12-test-case-catalog) |
| Security acceptance criterion | `SAC-NN` | [04 §17](04-security-and-compliance.md#17-security-acceptance-criteria) |
| Decision | `ADR-NNN` | [02 §10](02-system-architecture.md#10-architecture-decision-records) |

Status values: **Planned** → In progress → Done → Verified (RB tests green on staging) · **Deferred** (P3) · **Retired**.

## 2. Component legend

| Code | Component (see [02](02-system-architecture.md)) |
|------|------------------------------------------------|
| AUTH-UI | Workspace/console auth pages + Firebase Auth client SDK; invitation acceptance |
| SESSION | `packages/core/session.ts`, `/api/auth/session`, console session handling |
| CTX | `proxy.ts` host classification + `requireTenantContext` / `requireAgencyContext` / `requirePlatformContext` |
| AUTHZ | `packages/shared/permissions.ts`, `packages/core/authz.ts` |
| WRAP | `withTenantAction` / `withUserAction` / `withAgencyAction` / `withPlatformAction` |
| REPO | Scoped repositories incl. Member own-scope (`packages/core/repositories`) |
| SVC:x | Domain service `packages/core/services/x` + feature UI `features/x` |
| FN:x | Cloud Function job/trigger `functions/x` |
| CONSOLE | `apps/console` platform context |
| PARTNERS | `apps/console` agency context |
| PAY | `packages/core/payments` (gateway adapters, webhooks, reconciliation) |
| DOM | `packages/core/domains` (Vercel Domains API, authorized-domain sync) |
| RULES | `firebase/firestore.rules`, `firebase/storage.rules` |
| UI | `packages/ui` design system |
| MKT | Marketing/docs routes `(marketing)` |
| SEC-HDR | Headers/CSP/caching config |
| RL | Rate limiter |
| EMAIL | Email service + outbox + templates |
| AUDIT | `packages/core/audit.ts` |
| OPS | CI/CD, Vercel/GCP config, instances, monitoring, backups |

## 3. Functional requirements

| Req | Pri | Component | Task(s) | Test(s) | Acceptance criteria | Status |
|-----|-----|-----------|---------|---------|--------------------|--------|
| FR-AUTH-001 | P0 | AUTH-UI, SESSION, FN:orphanCleanup | T-02-01, T-02-10, T-03-04 | TC-AUTH-001 | [01 §2](01-product-requirements.md#2-authentication-auth) | Planned |
| FR-AUTH-002 | P1 | AUTH-UI, DOM (authorized domains) | T-02-01 | TC-AUTH-002 | 01 §2 | Planned |
| FR-AUTH-003 | P0 | AUTH-UI, EMAIL | T-02-03 | TC-AUTH-003 | 01 §2 | Planned |
| FR-AUTH-004 | P0 | SESSION | T-02-02 | TC-AUTH-004 | 01 §2 | Planned |
| FR-AUTH-005 | P3 | — | — | (TC-AUTH-006 deferred) | 01 §2 | Deferred ([CONFIRMED] OQ-10) |
| FR-AUTH-006 | P0 | SESSION, SVC:members | T-02-02, T-03-05 | TC-AUTH-005 | 01 §2 | Planned |
| FR-AUTH-007 | P3 | — | — | — | — | Deferred |
| FR-AUTH-008 | P0 | SESSION, CONSOLE, PARTNERS, RL, EMAIL | T-02-07, T-02-10, T-11-01 | TC-AUTH-007 | 01 §2 | Planned |
| FR-TEN-001 | P0 | SVC:tenants (provision), CONSOLE, PARTNERS | T-02-04 | TC-TEN-001 | [01 §3](01-product-requirements.md#3-tenancy-ten) | Planned |
| FR-TEN-002 | P0 | CONSOLE, PARTNERS, CTX | T-02-07, T-05-09 | TC-TEN-002, TC-SEC-015 | 01 §3 | Planned |
| FR-TEN-003 | P0 | SVC:tenants | T-02-04 | TC-TEN-003 | 01 §3 | Planned |
| FR-TEN-004 | P1 | CTX | T-02-05, T-11-03 | TC-TEN-004 | 01 §3 | Planned |
| FR-TEN-005 | P1 | DOM, CTX | T-05-07, T-11-03 | TC-TEN-008 | 01 §3, [05 §5.1](05-white-label-and-multi-tenancy.md#51-custom-domain-onboarding-fr-ten-005-adr-022) | Planned |
| FR-TEN-006 | P0 | SVC:tenants, FN:tenantPurge | T-06-10 | TC-TEN-005 | 01 §3 | Planned |
| FR-TEN-007 | P1 | FN:export | T-06-07 | TC-TEN-006 | 01 §3 | Planned |
| FR-TEN-008 | P1 | CTX, UI | T-02-06 | TC-TEN-007 | 01 §3 | Planned |
| FR-TEN-009 | P1 | DOM, CTX | T-05-07 | TC-TEN-009 | 01 §3 | Planned |
| FR-AGY-001 | P0 | CONSOLE, SVC:agencies | T-02-09 | TC-AGY-001 | [01 §24](01-product-requirements.md#24-agencies--resellers-agy) | Planned |
| FR-AGY-002 | P0 | AUTHZ, PARTNERS | T-02-09, T-03-01 | TC-AGY-002 | 01 §24 | Planned |
| FR-AGY-003 | P0 | CTX (agency), REPO | T-02-09, T-09-02 | TC-AGY-003 | 01 §24 | Planned |
| FR-AGY-004 | P1 | SVC:branding, FN:brandingResolve | T-05-06 | TC-AGY-004 | 01 §24 | Planned |
| FR-AGY-005 | P1 | PARTNERS | T-05-09 | TC-AGY-005 | 01 §24 | Planned |
| FR-AGY-006 | P2 | PARTNERS, SVC:usage | T-06-14 | TC-AGY-006 | 01 §24 | Planned |
| FR-RBAC-001 | P0 | SVC:invitations, EMAIL | T-03-04 | TC-RBAC-001 | [01 §4](01-product-requirements.md#4-roles-team--permissions-rbac) | Planned |
| FR-RBAC-002 | P0 | AUTHZ | T-03-01 | TC-RBAC-002 | 01 §4.3 | Planned |
| FR-RBAC-003 | P0 | SVC:members, AUTHZ | T-03-05 | TC-RBAC-003 | 01 §4 | Planned |
| FR-RBAC-004 | P0 | REPO (own-scope), AUTHZ, SVC:* | T-03-02, T-03-10, T-04-08 | TC-RBAC-004 | 01 §4 | Planned |
| FR-RBAC-005 | P3 | — | — | — | — | Deferred |
| FR-RBAC-006 | P3 | — | — | — | — | Deferred |
| FR-RBAC-007 | P1 | SVC:members | T-03-05 | TC-RBAC-005 | 01 §4 | Planned |
| FR-REC-001 | P1 | SVC:*, FN:trashPurge | T-04-09 | TC-REC-001 | [01 §5](01-product-requirements.md#5-common-record-behavior-rec) | Planned |
| FR-REC-002 | P2 | SVC:tags | T-04-10 | TC-REC-002 | 01 §5 | Planned |
| FR-REC-003 | P3 | — | — | — | — | Deferred |
| FR-COM-001 | P0 | SVC:companies | T-04-02 | TC-COM-001 | [01 §6](01-product-requirements.md#6-companies-com) | Planned |
| FR-COM-002 | P1 | SVC:companies | T-04-02 | TC-COM-002 | 01 §6 | Planned |
| FR-COM-003 | P2 | SVC:companies | T-04-02 | TC-COM-003 | 01 §6 | Planned |
| FR-CON-001 | P0 | SVC:contacts | T-04-03 | TC-CON-001 | [01 §7](01-product-requirements.md#7-contacts--customers-con) | Planned |
| FR-CON-002 | P1 | SVC:contacts | T-04-03 | TC-CON-002 | 01 §7 | Planned |
| FR-CON-003 | P1 | SVC:contacts | T-04-03 | TC-CON-003 | 01 §7 | Planned |
| FR-CON-004 | P1 | SVC:contacts, SVC:deals | T-04-03, T-04-05 | TC-CON-004 | 01 §7 | Planned |
| FR-LEAD-001 | P0 | SVC:leads | T-04-04 | TC-LEAD-001 | [01 §8](01-product-requirements.md#8-leads-lead) | Planned |
| FR-LEAD-002 | P0 | SVC:leads, FN:leadRelink | T-04-04 | TC-LEAD-002 | 01 §8 | Planned |
| FR-LEAD-003 | P1 | SVC:leads, SVC:notifications | T-04-04, T-06-04 | TC-LEAD-003 | 01 §8 | Planned |
| FR-LEAD-004 | P3 | — | — | — | — | Deferred |
| FR-DEAL-001 | P0 | SVC:deals | T-04-05 | TC-DEAL-001 | [01 §9](01-product-requirements.md#9-deals--pipeline-deal) | Planned |
| FR-DEAL-002 | P1 | SVC:pipelines, FN:stageMigration | T-04-05 | TC-DEAL-002 | 01 §9 | Planned |
| FR-DEAL-003 | P1 | SVC:deals, UI | T-04-05, T-07-03 | TC-DEAL-003 | 01 §9 | Planned |
| FR-DEAL-004 | P1 | SVC:deals | T-04-05 | TC-DEAL-004 | 01 §9 | Planned |
| FR-DEAL-005 | P3 | — | — | — | — | Deferred |
| FR-TASK-001 | P0 | SVC:tasks | T-04-06 | TC-TASK-001 | [01 §10](01-product-requirements.md#10-tasks-task) | Planned |
| FR-TASK-002 | P1 | SVC:tasks | T-04-06 | TC-TASK-002 | 01 §10 | Planned |
| FR-TASK-003 | P2 | FN:reminders, EMAIL | T-06-05 | TC-TASK-003 | 01 §10 | Planned |
| FR-TASK-004 | P3 | — | — | — | — | Deferred |
| FR-ACT-001 | P0 | SVC:activities, UI (SafeMarkdown) | T-04-07 | TC-ACT-001, TC-SEC-010 | [01 §11](01-product-requirements.md#11-activities--communication-act) | Planned |
| FR-ACT-002 | P1 | SVC:activities | T-04-07 | TC-ACT-002 | 01 §11 | Planned |
| FR-ACT-003 | P3 | — | — | — | — | Deferred |
| FR-ACT-004 | P3 | — | — | — | — | Deferred |
| FR-DASH-001 | P1 | SVC:dashboard | T-06-02 | TC-DASH-001 | [01 §12](01-product-requirements.md#12-dashboard-dash) | Planned |
| FR-DASH-002 | P2 | SVC:dashboard, REPO | T-06-02 | TC-DASH-002 | 01 §12 | Planned |
| FR-SRCH-001 | P1 | SVC:search, RL, REPO | T-06-01 | TC-SRCH-001 | [01 §13](01-product-requirements.md#13-search-filtering-sorting-srch) | Planned |
| FR-SRCH-002 | P0 | REPO, UI (list kit) | T-04-01, T-03-10 | TC-SRCH-002 | 01 §13 | Planned |
| FR-SRCH-003 | P3 | — | — | — | — | Deferred |
| FR-SRCH-004 | P3 | — | — | — | ADR-010 | Deferred |
| FR-RPT-001 | P1 | SVC:reports | T-06-03 | TC-RPT-001 | [01 §14](01-product-requirements.md#14-reporting-rpt) | Planned |
| FR-RPT-002 | P2 | SVC:reports | T-06-03 | TC-RPT-002 | 01 §14 | Planned |
| FR-RPT-003 | P3 | — | — | — | — | Deferred |
| FR-NOTF-001 | P1 | SVC:notifications | T-06-04 | TC-NOTF-001 | [01 §15](01-product-requirements.md#15-notifications-notf) | Planned |
| FR-NOTF-002 | P2 | SVC:notifications, EMAIL | T-06-05 | TC-NOTF-002 | 01 §15 | Planned |
| FR-NOTF-003 | P3 | — | — | — | — | Deferred |
| FR-IMP-001 | P1 | FN:import, SVC:import | T-06-06 | TC-IMP-001 | [01 §16](01-product-requirements.md#16-import--export-imp) | Planned |
| FR-IMP-002 | P1 | FN:export | T-06-07 | TC-IMP-002 | 01 §16 | Planned |
| FR-IMP-003 | P3 | — | — | — | — | Deferred |
| FR-BRAND-001 | P0 | SVC:branding, upload pipeline | T-05-01 | TC-BRAND-001 | [01 §17](01-product-requirements.md#17-branding-brand) | Planned |
| FR-BRAND-002 | P1 | SVC:branding, UI tokens | T-05-02 | TC-BRAND-002 | 01 §17 | Planned |
| FR-BRAND-003 | P1 | EMAIL | T-05-03 | TC-BRAND-003 | 01 §17 | Planned |
| FR-BRAND-004 | P2 | SVC:entitlements | T-05-04 | TC-BRAND-004 | 01 §17 | Planned |
| FR-BRAND-005 | P2 | EMAIL, PARTNERS | T-05-08 | TC-BRAND-003 | 01 §17 | Planned |
| FR-SET-001 | P1 | SVC:settings | T-04-11 | TC-SET-001 | [01 §18](01-product-requirements.md#18-settings-set) | Planned |
| FR-SET-002 | P1 | SVC:profile | T-04-11 | TC-SET-002 | 01 §18 | Planned |
| FR-PLAN-001 | P1 | SVC:entitlements | T-05-04 | TC-PLAN-001 | [01 §19](01-product-requirements.md#19-plans-limits--entitlements-plan) | Planned |
| FR-PLAN-002 | P2 | SVC:usage, FN:reconcile | T-05-05 | TC-PLAN-002 | 01 §19 | Planned |
| FR-PLAN-003 | — | — | — | — | Superseded by FR-BILL-* | Retired (2026-10-09) |
| FR-PLAN-004 | P1 | SVC:entitlements | T-05-04 | TC-PLAN-003 | 01 §19, [05 §8](05-white-label-and-multi-tenancy.md#8-feature-flags-plan-limits-and-configuration-inheritance) | Planned |
| FR-BILL-001 | P1 | PAY, PARTNERS | T-06-11, T-06-13 | TC-BILL-001 | [01 §25](01-product-requirements.md#25-billing--payments-bill) | Planned |
| FR-BILL-002 | P1 | PAY, SVC:billing | T-06-12 | TC-BILL-002 | 01 §25 | Planned |
| FR-BILL-003 | P0 | PAY (webhooks), FN:applyPaymentEvent, FN:paymentReconcile | T-06-11 | TC-BILL-003 | 01 §25 | Planned |
| FR-BILL-004 | P1 | SVC:billing, PARTNERS | T-06-12 | TC-BILL-004 | 01 §25 | Planned |
| FR-BILL-005 | P2 | SVC:billing, PARTNERS | T-06-12 | TC-BILL-005 | 01 §25 | Planned |
| FR-AUD-001 | P0 | AUDIT | T-03-06 | TC-AUD-001 | [01 §20](01-product-requirements.md#20-audit-log-aud) | Planned |
| FR-AUD-002 | P2 | SVC:audit viewer | T-06-08 | TC-AUD-002 | 01 §20 | Planned |
| FR-AUD-003 | P0 | AUDIT, RULES | T-03-06, T-03-03 | TC-AUD-003 | 01 §20 | Planned |
| FR-PRIV-001 | P1 | SVC:privacy, FN:export | T-06-09 | TC-PRIV-001 | [01 §21](01-product-requirements.md#21-privacy-priv) | Planned |
| FR-PRIV-002 | P1 | SVC:privacy | T-06-09 | TC-PRIV-002 | 01 §21 | Planned |
| FR-PRIV-003 | P1 | SVC:profile, SESSION | T-06-09 | TC-PRIV-003 | 01 §21 | Planned |
| FR-PUB-001 | P1 | MKT | T-08-01 | TC-PUB-001 | [01 §22](01-product-requirements.md#22-public-site-pub) | Planned |
| FR-PUB-002 | P2 | MKT | T-08-02 | TC-PUB-002 | 01 §22 | Planned |
| FR-PUB-003 | P1 | AUTH-UI, CTX, SVC:branding | T-02-08, T-05-01 | TC-PUB-003 | 01 §22 | Planned |

## 4. Non-functional requirements

| Req | Pri | Component | Task(s) | Test(s) | Acceptance criteria | Status |
|-----|-----|-----------|---------|---------|--------------------|--------|
| NFR-SEC-001 | P0 | CTX, REPO, SEC-HDR (caching) | T-02-05, T-03-02, T-03-09, T-09-02 | TC-SEC-001, TC-SEC-012, TC-SEC-013, TC-SEC-015 | [04 §17](04-security-and-compliance.md#17-security-acceptance-criteria) SAC-02, SAC-11, SAC-12, SAC-15 | Planned |
| NFR-SEC-002 | P0 | WRAP, AUTHZ, CTX, REPO | T-02-05, T-03-01, T-03-07, T-09-02 | TC-SEC-002, TC-SEC-004 | SAC-01, SAC-03, SAC-17 | Planned |
| NFR-SEC-003 | P0 | RULES | T-03-03 | TC-SEC-003 | SAC-04 | Planned |
| NFR-SEC-004 | P0 | shared schemas, UI SafeMarkdown | T-03-07, T-04-07 | TC-SEC-005, TC-SEC-010 | SAC-09 | Planned |
| NFR-SEC-005 | P1 | SEC-HDR, SESSION (CSRF) | T-03-09, T-02-02, T-09-03 | TC-SEC-006, TC-SEC-011 | SAC-05, SAC-10, SAC-13 | Planned |
| NFR-SEC-006 | P1 | RL | T-03-08 | TC-SEC-007 | SAC-06 | Planned |
| NFR-SEC-007 | P0 | OPS (federation, Secret Manager, CI scans), env.ts | T-01-05, T-01-06, T-01-09, T-09-04, T-11-01 | TC-SEC-008 | SAC-07 | Planned |
| NFR-SEC-008 | P1 | OPS (CI) | T-01-05, T-09-04 | TC-SEC-009 | SAC-08 | Planned |
| NFR-SEC-009 | P1 | Upload pipeline, FN:import | T-05-01, T-06-06 | TC-BRAND-001, TC-IMP-001 | [04 §13](04-security-and-compliance.md#13-file-upload-security) | Planned |
| NFR-SEC-010 | P1 | SEC-HDR, OPS, DOM | T-03-09, T-11-01, T-11-03 | TC-SEC-014 | 04 §11 | Planned |
| NFR-SEC-011 | P0 | PAY | T-06-11, T-09-07 | TC-BILL-003, TC-SEC-016 | SAC-14, SAC-18 | Planned |
| NFR-PERF-001 | P1 | MKT | T-08-05 | TC-PERF-001 | [07 §7](07-seo-aeo-and-performance.md#7-performance-budgets-and-acceptance-criteria) | Planned |
| NFR-PERF-002 | P1 | All server paths (Vercel ↔ Firestore region pairing) | T-01-09, T-09-06 | TC-PERF-002 | 07 §7 | Planned |
| NFR-PERF-003 | P2 | Build | T-08-05 | TC-PERF-001 | 07 §7 | Planned |
| NFR-A11Y-001 | P0 | UI, all screens incl. consoles | T-01-08, T-07-02, T-07-03 | TC-A11Y-001, TC-A11Y-002, TC-A11Y-003 | [06 §8](06-ui-ux-and-responsive-design.md#8-accessibility-requirements) | Planned |
| NFR-RESP-001 | P1 | UI | T-01-03, T-07-01, T-07-04 | TC-RESP-001, TC-VIS-001 | [06 §7](06-ui-ux-and-responsive-design.md#7-responsive-behavior) | Planned |
| NFR-REL-001 | P1 | OPS | T-01-11, T-11-02 | TC-REL-002 | [10 §10](10-ci-cd-and-deployment.md#10-monitoring-and-alerting) | Planned |
| NFR-REL-002 | P1 | OPS | T-10-04, T-11-01 | TC-REL-001 | [10 §9](10-ci-cd-and-deployment.md#9-backups-and-disaster-recovery) | Planned |
| NFR-OBS-001 | P1 | logger, OPS (log drains) | T-01-07, T-09-08, T-11-02 | TC-OBS-001 | [02 §8.3](02-system-architecture.md#83-logging) | Planned |
| NFR-MAINT-001 | P1 | OPS (CI) | T-01-01, T-01-05, T-09-05 | TC-MAINT-001 | [09 §10](09-testing-and-quality-assurance.md#10-coverage-targets) | Planned |
| NFR-SEO-001 | P0 | CTX/SEC-HDR (X-Robots-Tag on all workspace & console hosts), MKT robots/sitemap | T-08-04 | TC-SEO-001 | [07 §1](07-seo-aeo-and-performance.md#1-surface-classification-and-index-policy), 07 §5 | Planned |
| NFR-SEO-002 | P1 | MKT | T-08-03 | TC-SEO-002 | 07 §2–3 | Planned |
| NFR-COST-001 | P2 | REPO, OPS | T-03-10, T-08-06, T-11-01 | TC-COST-001 | [03 §11](03-database-schema.md#11-cost-optimization) | Planned |
| NFR-I18N-001 | P2 | UI (message catalog) | T-01-08 | TC-I18N-001 | 00 §7 | Planned |
| NFR-PRIV-001 | P1 | OPS (instance/project setup) | T-01-09, T-01-11 | TC-PRIV-004 | 00 §7 | Planned |

## 5. Use cases and goals coverage

| Use case | Requirements | E2E journey ([09 §7](09-testing-and-quality-assurance.md#7-end-to-end-tests)) |
|----------|-------------|------------------|
| UC-01 Provision agency | FR-AGY-001/002, FR-AUTH-008, FR-BILL-001 | 1 |
| UC-02 Provision workspace + custom domain | FR-TEN-001/003/005/009 | 1 |
| UC-03 Accept invite, brand, invite team | FR-AUTH-001, FR-RBAC-001..003, FR-BRAND-001/002, FR-AGY-004 | 1, 2, 8 |
| UC-04 Lead → convert | FR-LEAD-001..003, FR-CON-001, FR-COM-001, FR-DEAL-001 | 3 |
| UC-05 Pipeline | FR-DEAL-001..004, FR-CON-004 | 3 |
| UC-06 Tasks | FR-TASK-001..003 | 4 |
| UC-07 Activities | FR-ACT-001/002 | 5 |
| UC-08 Dashboard/reports | FR-DASH-001/002, FR-RPT-001/002, FR-RBAC-004 | 17 (+TC-DASH-001, TC-RPT-001) |
| UC-09 Import/export | FR-IMP-001/002 | 6, 7 |
| UC-10 Subscribe & pay | FR-BILL-001..005 | 18 |
| UC-11 DSAR | FR-PRIV-001/002 | 14 |
| UC-12 Suspend/delete | FR-TEN-002/006, FR-AGY-001 | 13 |
| UC-13 Audit review | FR-AUD-001..003 | (TC-AUD-002) |

| Goal | Verified by |
|------|------------|
| G-1 Isolation (workspaces and agencies) | TC-SEC-001/012/013/015, TC-AGY-003, TC-RBAC-004, pentest (T-09-07) |
| G-2 Onboarding speed | UAT timing (T-10-03) |
| G-3 Core workflow | Journeys 3–5 on mobile + desktop (TC-RESP-001) |
| G-4 Operability | Onboarding checklist (12 §8), CI gates (TC-MAINT-001), rollback drill (13 I8), instance workflow (T-01-11) |
| G-5 A11y & performance | TC-A11Y-*, TC-PERF-001 |
| G-6 Agentic traceability | This matrix + protected-path controls ([08 §8](08-ai-agentic-development-workflow.md#8-guardrails-protected-areas-and-prohibited-actions)) |
| G-7 Monetization | TC-BILL-001..005, journey 18, UAT (T-10-03) |

### Supporting tasks (enablers, governance, validation)

| Task | Role |
|------|------|
| T-00-01 … T-00-05 | Plan approval, ADR acceptance, scope freeze, vendor/domain selection, legal kickoff |
| T-01-02, T-01-04 | Test runner and emulator/fixture harness (NFR-MAINT-001, NFR-SEC-003) |
| T-01-10 | Agent context files and templates (G-6) |
| T-07-05 | UI state coverage ([06 §9](06-ui-ux-and-responsive-design.md#9-states-loading-empty-error-success-offline)) |
| T-09-01 | Threat-model review feeding NFR-SEC-* |
| T-10-01, T-10-02, T-10-05 | Staging parity, UAT data, defect triage |
| T-11-04 … T-11-06 | Go-live, hypercare, runbooks ([13](13-release-readiness-checklist.md)) |

## 6. Gap analysis

**Requirements without implementation tasks or tests (intentional — post-MVP, P3):**
FR-AUTH-005, FR-AUTH-007, FR-RBAC-005, FR-RBAC-006, FR-REC-003, FR-LEAD-004, FR-DEAL-005, FR-TASK-004, FR-ACT-003, FR-ACT-004, FR-SRCH-003, FR-SRCH-004, FR-RPT-003, FR-NOTF-003, FR-IMP-003 (**15 items**). FR-AUTH-005 (MFA) is flagged highest-priority post-launch because of R-15.
**Retired:** FR-PLAN-003 (superseded by FR-BILL-001..005).
**MVP requirements (P0–P2) without a task:** none.
**MVP requirements without a test:** none.
**P0 requirements without a release-blocking test:** none.
**Requirements verified only manually:** NFR-PRIV-001 (TC-PRIV-004), NFR-REL-001 (TC-REL-002), NFR-REL-002 (TC-REL-001), part of NFR-A11Y-001 (TC-A11Y-003), FR-AUTH-008 AC1 Workspace 2SV policy (evidence in [13](13-release-readiness-checklist.md) F7).
**Tests without a requirement:** none.
**Dependencies on open questions:** instance model (OQ-19) → ADR-019, T-01-11 · merchant of record (OQ-20) → FR-BILL-001..005 · agency CRM access (OQ-21) → FR-AGY-002 · agency provisioning (OQ-22) → FR-TEN-001 · agency console white-label (OQ-23) → FR-AGY-005 · production regions (OQ-24) → NFR-PRIV-001 · plan pricing (OQ-25) → FR-PLAN-001, FR-BILL-001 · email provider (OQ-06) → FR-BRAND-003/005 · rate-limit store (OQ-07) → NFR-SEC-006 · currency (OQ-08) → FR-DEAL-001.

## 7. Maintenance rules

1. New requirement → add row here + task + test in the same planning PR.
2. Never reuse a retired ID; mark retired rows `Retired (reason, date)`.
3. Status moves to **Verified** only with a link to a green CI/staging run of the mapped tests.
4. CI check (proposed, T-01-05 follow-up): script parses this file and 09 §12 to ensure every MVP FR/NFR has ≥ 1 task and ≥ 1 test, and every TC referenced exists.
