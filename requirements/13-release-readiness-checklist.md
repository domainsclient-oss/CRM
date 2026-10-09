# 13 — Release Readiness Checklist (MVP v1.0)

> **Prev:** [12 Environment & Configuration](12-environment-and-configuration.md) · **Next:** [14 Traceability Matrix](14-traceability-matrix.md)
> Completed by the Lead with evidence links (CI run, report, or document) for every item. Any unchecked item in §8 blocks release. Sign-off in §9 is by humans only.

## Contents

1. [Functional readiness](#1-functional-readiness)
2. [Security and tenant isolation](#2-security-and-tenant-isolation)
3. [Testing and accessibility](#3-testing-and-accessibility)
4. [SEO, AEO, and performance](#4-seo-aeo-and-performance)
5. [Infrastructure, backups, and monitoring](#5-infrastructure-backups-and-monitoring)
6. [Documentation and operational readiness](#6-documentation-and-operational-readiness)
7. [Legal and privacy](#7-legal-and-privacy)
8. [Explicit blockers](#8-explicit-blockers)
9. [Final release approval](#9-final-release-approval)

---

## 1. Functional readiness

| # | Item | Evidence |
|---|------|----------|
| F1 | [ ] All P0 and P1 requirements implemented; P2 implemented or deferral approved and recorded in [14](14-traceability-matrix.md) | Traceability matrix status |
| F2 | [ ] UAT sign-off from ≥ 3 pilot tenants (UC-01..UC-12) | T-10-03 report |
| F3 | [ ] Onboarding to first deal < 15 min (G-2) measured in UAT | T-10-03 |
| F4 | [ ] Zero open SEV1/SEV2 defects; SEV3 triaged with owners | Issue tracker |
| F5 | [ ] Branded emails (all templates) verified in Gmail, Outlook, Apple Mail; SPF/DKIM/DMARC pass | Screenshots + headers |
| F6 | [ ] Default plans/entitlements configured in production (`plans/*`) | Console export |
| F7 | [ ] Platform superadmin accounts created (Google Workspace accounts from allowlisted domain, 2-Step Verification enforced by Workspace policy — screenshot of admin policy); break-glass procedure documented | Console + runbook |
| F8 | [ ] Pilot agency configured: branding, staff, gateway in **live** mode with validated plan prices, webhook endpoint registered at gateway; manual-billing fallback documented | Agency console |
| F9 | [ ] Pilot custom domains active with valid certificates; canonical redirects verified; Firebase authorized domains synced | Domain status page |

## 2. Security and tenant isolation

| # | Item | Evidence |
|---|------|----------|
| S1 | [ ] Isolation registry covers 100% of Server Actions; TC-SEC-001/002/004/012/013/015 green on release commit | CI run |
| S2 | [ ] Rules deploy = deny-all (or ADR-approved), TC-SEC-003 green; deployed rules diff matches repo | CI + console |
| S3 | [ ] Security headers/CSP verified on prod hosts (TC-SEC-006); HSTS active (TC-SEC-014) | Scan output |
| S4 | [ ] No Critical/High findings open: CodeQL, `pnpm audit`, ZAP, pentest | Reports |
| S5 | [ ] Secret scan clean; no SA keys exist in prod project; key-creation org policy on | gcloud output |
| S6 | [ ] IAM reviewed: least privilege per [04 §6](04-security-and-compliance.md#6-firebase-admin-sdk-and-service-accounts); human prod access minimal | IAM export |
| S7 | [ ] Rate limits active with production backend (not memory) | Config + TC-SEC-007 |
| S8 | [ ] Session settings: cookie flags, lifetime, revocation checks verified in prod-like staging | TC-AUTH-004/005 |
| S9 | [ ] Privileged-account controls verified (TC-AUTH-007): domain-restricted Google sign-in for platform staff, session lifetimes, re-auth, login alerts; residual no-MFA risk (R-15) re-accepted in writing by owner | CI + sign-off |
| S11 | [ ] Agency isolation and no agency CRM access (TC-AGY-002, TC-AGY-003); Member own-scope (TC-RBAC-004) | CI |
| S12 | [ ] Payment webhooks verified, idempotent, reconciled (TC-BILL-003); no card data anywhere (TC-SEC-016); gateway secrets only in Secret Manager | CI + review |
| S13 | [ ] Vercel → GCP access is keyless (OIDC federation) or approved fallback key is rotated and least-privileged | IAM/Vercel review |
| S10 | [ ] Threat model updated; residual risks accepted by owner | T-09-01 |

## 3. Testing and accessibility

| # | Item | Evidence |
|---|------|----------|
| Q1 | [ ] All release-blocking tests ([09 §11](09-testing-and-quality-assurance.md#11-release-blocking-tests)) green on tagged commit | CI |
| Q2 | [ ] Coverage thresholds met ([09 §10](09-testing-and-quality-assurance.md#10-coverage-targets)) | Coverage report |
| Q3 | [ ] Full E2E across Chromium/Firefox/WebKit + viewport matrix green | Nightly/pre-release run |
| Q4 | [ ] axe: 0 serious/critical on all routes (TC-A11Y-001); keyboard journeys (TC-A11Y-002) green | CI |
| Q5 | [ ] Screen-reader checklist completed with no blockers (TC-A11Y-003) | Report |
| Q6 | [ ] Visual regression baselines approved (TC-VIS-001) | CI |
| Q7 | [ ] Load test meets NFR-PERF-002 (TC-PERF-002) | k6 report |
| Q8 | [ ] No quarantined RB tests | Test report |

## 4. SEO, AEO, and performance

| # | Item | Evidence |
|---|------|----------|
| P1 | [ ] Tenant/console/assets hosts send `noindex`; sitemap only on www (TC-SEO-001) | CI + curl output on prod |
| P2 | [ ] Public metadata, canonicals, OG, JSON-LD valid (TC-SEO-002) | CI |
| P3 | [ ] Lighthouse thresholds met on public pages (TC-PERF-001) | LHCI report |
| P4 | [ ] Search Console & Bing Webmaster verified for www; sitemap submitted | Screenshots |
| P5 | [ ] Staging environments fully `noindex` and not linked publicly | curl output |
| P6 | [ ] Firestore read budgets within targets (TC-COST-001) | Report |

## 5. Infrastructure, backups, and monitoring

| # | Item | Evidence |
|---|------|----------|
| I1 | [ ] Firestore location = approved region (TC-PRIV-004) | Console |
| I2 | [ ] PITR enabled; daily + weekly backup schedules active; first backup succeeded | gcloud output |
| I3 | [ ] Restore drill completed within RTO (TC-REL-001) | T-10-04 |
| I4 | [ ] All composite indexes `READY` in prod; TTL policies enabled | gcloud output |
| I5 | [ ] Uptime checks, alert policies, notification channels, dashboards live (TC-REL-002) | Monitoring |
| I6 | [ ] Budget alerts at 50/80/100% | Billing |
| I7 | [ ] DNS, wildcard cert, CAA, email domain records live | DNS check |
| I8 | [ ] Rollback procedure rehearsed on staging (app + rules + functions) | Drill notes |
| I9 | [ ] Min instances / max instances configured; functions max instances capped | Config |

## 6. Documentation and operational readiness

| # | Item | Evidence |
|---|------|----------|
| D1 | [ ] Requirements docs updated to as-built; ADRs accepted/superseded | Repo |
| D2 | [ ] Runbooks (10 §11 list) written and reviewed; tabletop exercise done | T-11-06 |
| D3 | [ ] On-call rota for launch + 2 weeks hypercare | Rota |
| D4 | [ ] Public docs/help center covers all MVP features; support contact path works | Docs site |
| D5 | [ ] Changelog/release notes published | Repo |
| D6 | [ ] Status page or incident communication channel defined | Link |

## 7. Legal and privacy

| # | Item | Evidence |
|---|------|----------|
| L1 | [ ] Privacy Policy, Terms, Cookie Policy published (legal review) | URLs |
| L2 | [ ] DPA template and subprocessor list available to tenants | URLs |
| L3 | [ ] Vendor DPAs signed (Google Cloud, email, Redis, error tracking) | Records |
| L4 | [ ] DSAR export/erasure tools verified (TC-PRIV-001/002); account deletion (TC-PRIV-003) | CI |
| L5 | [ ] Backup retention and erasure behavior disclosed | Privacy policy |

## 8. Explicit blockers

Production deployment **must not proceed** if any of these is true:

1. Any release-blocking test fails or is quarantined.
2. Any open Critical or High security finding (including those listed in [04 §15](04-security-and-compliance.md#15-release-blocking-vulnerabilities)).
3. Any evidence or suspicion of cross-tenant data access path.
4. Firestore/Storage rules differ from approved repo version or allow client access without ADR.
5. PITR or scheduled backups not enabled in production, or restore drill not completed.
6. Private pages indexable or tenant data in sitemap/metadata.
7. Secrets or service-account keys found in repo, build artifacts, or prod project.
8. Platform/agency console reachable without FR-AUTH-008 controls, or R-15 not re-accepted by the owner.
13. Payment webhooks able to change entitlements without verified signature + gateway re-fetch, or any card/bank data stored or logged.
14. Any cross-agency access path, agency-context CRM access, or Member able to read others' records.
15. A custom domain routable before verification, or a workspace without a working canonical host.
9. Serious/critical accessibility violations on MVP flows.
10. Missing human approval for any H-checkpoint item in this release (migrations, auth changes, rules).
11. No on-call coverage for launch window.
12. Legal documents (L1–L2) not published.

## 9. Final release approval

| Role | Name | Decision | Date | Notes |
|------|------|----------|------|-------|
| Product owner | | ☐ Go ☐ No-go | | |
| Technical lead / architect | | ☐ Go ☐ No-go | | |
| Security reviewer | | ☐ Go ☐ No-go | | |
| QA lead | | ☐ Go ☐ No-go | | |
| Operations / on-call lead | | ☐ Go ☐ No-go | | |

Release proceeds only with **all** Go decisions and §8 clear. The approval record is attached to the GitHub Environment deployment approval (H6).
