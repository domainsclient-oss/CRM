# Phase 9 plan — Security hardening and automated testing

Roadmap: [11 §Phase 9](../11-implementation-roadmap.md#phase-9--security-hardening-and-comprehensive-automated-testing). Tests: [09](../09-testing-and-quality-assurance.md). Security: [04](../04-security-and-compliance.md).

| Task | Work here | Needs outside this repo |
|------|-----------|-------------------------|
| T-09-01 | Threat-model walk-through (04) against the code; security review of protected areas (proxies, session/auth, action wrappers, tenant context, scoped repositories, API routes, rules, uploads, mail rendering, domains). Report with findings + fixes: `T-09-01-security-review.md` | Human sign-off |
| T-09-02 | Close gaps in isolation suites: every entity × operation IDOR (TC-SEC-001), reference smuggling + search/report/export/notification leakage (TC-SEC-012), cache headers (TC-SEC-013), suspended/removed sessions (TC-SEC-015), Member own-scope across all read paths (TC-RBAC-004), cross-agency (TC-AGY-003); E2E cross-tenant replay (cookie from workspace A replayed on host B; action replay across hosts) | — |
| T-09-03 | ZAP baseline config + script, ready to point at staging | Staging (T-01-09) |
| T-09-04 | Client-bundle scan for server env names / key material (TC-SEC-008) as a script + CI step; local gitleaks-equivalent check; SBOM (CycloneDX) script; dependency remediation | — |
| T-09-05 | Coverage over unit + integration + registry; thresholds per 09 §10 enforced in config and CI; gap tests | — |
| T-09-06 | k6 script (A-06 mix) + revocation-latency check script, ready for staging | Staging |
| T-09-07 | Pentest scope document | External tester |
| T-09-08 | Logger field + redaction tests over every log call site pattern (TC-OBS-001); alert definitions documented | GCP project for wiring |

Protected paths likely touched: `packages/core/**` (tests and any security fixes), `.github/workflows/ci.yml` (coverage + bundle-scan steps), possibly `apps/*/src/proxy.ts` and `apps/web/src/app/api/**` (fixes from review). All listed in the report for human review.
