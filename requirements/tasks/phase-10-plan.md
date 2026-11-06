# Phase 10 plan — Staging validation and UAT

Roadmap: [11 §Phase 10](../11-implementation-roadmap.md#phase-10--staging-validation-and-user-acceptance-testing).

Everything in Phase 10 runs on **staging**, which needs the cloud accounts from T-01-09 (owner action). This repo provides the tooling and scripts; the runs themselves happen once staging exists.

| Task | Prepared in repo | Needs |
|------|------------------|-------|
| T-10-01 Staging parity | [T-10-01-staging-parity.md](T-10-01-staging-parity.md) checklist; the server environment validator refuses a staging configuration with memory rate limits, console email, test flags, missing secrets or emulator hosts | Staging project + Vercel project |
| T-10-02 UAT environment | `pnpm uat:seed --config uat/pilot.json` provisions the pilot agency and 3 workspaces (platform host, agency subdomain, custom domain) through the real services. Idempotent; refuses production; tested on emulators | Staging, pilot agency contacts, DNS |
| T-10-03 UAT | [T-10-03-uat-scripts.md](T-10-03-uat-scripts.md): UC-01..13 step scripts, the G-2 timing sheet and sign-off. UC-10 is blocked until Phase 6b | Pilot testers |
| T-10-04 Restore drill | [T-10-04-restore-drill.md](T-10-04-restore-drill.md) runbook; `pnpm restore:drill` (compare restored copy vs source + re-apply erasures, R-09). Tested on emulators | Staging backups |
| T-10-05 Triage | Defects tracked in task cards; full regression = `pnpm test:coverage` + `pnpm test:e2e:auth` + smoke + `pnpm perf:lighthouse` + ZAP + k6 | UAT results |

Also in this phase: the `authz.denied` log metric (10 §10 security alert), emitted by the action wrappers with pseudonymous IDs.
