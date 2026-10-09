# 10 — CI/CD and Deployment

> **Prev:** [09 Testing & QA](09-testing-and-quality-assurance.md) · **Next:** [11 Implementation Roadmap](11-implementation-roadmap.md)
> v1.1 — **Vercel** hosting ([CONFIRMED], ADR-007) and multi-instance deployments (ADR-019). Assumes GitHub + GitHub Actions (A-08). Commands/flags marked **(verify)** must be confirmed against current CLI/API docs in T-01-05/T-01-09.

## Contents

1. [Branching and pull requests](#1-branching-and-pull-requests)
2. [Continuous integration and quality gates](#2-continuous-integration-and-quality-gates)
3. [Environments, instances, and Firebase project separation](#3-environments-instances-and-firebase-project-separation)
4. [Configuration and secret management](#4-configuration-and-secret-management)
5. [Deployment pipelines](#5-deployment-pipelines)
6. [Indexes, Security Rules, Functions, and migrations](#6-indexes-security-rules-functions-and-migrations)
7. [Hosting and domain configuration](#7-hosting-and-domain-configuration)
8. [Rollback](#8-rollback)
9. [Backups and disaster recovery](#9-backups-and-disaster-recovery)
10. [Monitoring and alerting](#10-monitoring-and-alerting)
11. [Incident response](#11-incident-response)
12. [Production release checklist](#12-production-release-checklist)

---

## 1. Branching and pull requests

- **Trunk-based**: `main` always deployable; short-lived branches `feat/T-04-03-contacts`, `fix/...`, `chore/...` (≤ 3 days).
- Branch protection on `main`: PR required, ≥ 1 approving review (human or designated reviewer agent per [08](08-ai-agentic-development-workflow.md)) **plus** CODEOWNERS approval for protected paths, all required checks green, squash merge, no force push, signed commits recommended.
- Every PR gets Vercel **preview deployments** (web + console) wired to the **dev** Firebase project only; previews are `noindex` and protected by Vercel deployment protection (verify plan feature).
- PR size guideline ≤ 400 changed lines (excl. tests/generated).
- Releases: semantic version tags `vX.Y.Z` on `main`; changelog from Conventional Commits. **One tag is released to all instances** (R-18).
- Hotfix: branch from `main`, same gates (expedited review), tag patch release.

## 2. Continuous integration and quality gates

```mermaid
flowchart LR
  PR[Pull request] --> A[Install (pnpm, frozen lockfile, cache)]
  A --> B[Lint + format + typecheck]
  A --> C[Unit + component tests + coverage]
  A --> D[Emulator: integration + rules + functions tests\n+ gateway & Vercel API mocks]
  A --> E[Security: gitleaks, pnpm audit, CodeQL]
  B & C & D --> F[Build apps (next build) + bundle budgets]
  F --> G[Playwright smoke + affected E2E (4 shards)]
  F --> P[Vercel preview deploy → preview smoke]
  F --> H[Lighthouse CI (if marketing changed)]
  G & H & E & P --> OK{All required checks green}
  OK -->|yes| MERGE[Mergeable]
```

| Gate | Required on PR | Nightly | Pre-release |
|------|:---:|:---:|:---:|
| ESLint / Prettier / `tsc` | ✓ | ✓ | ✓ |
| Unit + component + coverage thresholds ([09 §10](09-testing-and-quality-assurance.md#10-coverage-targets)) | ✓ | ✓ | ✓ |
| Integration (emulators) + rules + functions | ✓ | ✓ | ✓ |
| Isolation registries (tenant, agency, platform actions) complete | ✓ | ✓ | ✓ |
| Index coverage check (incl. Member own-scope variants) | ✓ | ✓ | ✓ |
| Protected-file grep checks (rules `if true`, `.only(`, `dangerouslySetInnerHTML`, raw gateway payload logging) | ✓ | | ✓ |
| `next build` both apps + bundle budgets | ✓ | ✓ | ✓ |
| E2E smoke + affected | ✓ | | |
| Full E2E (3 browsers + viewport matrix) + a11y + visual | | ✓ | ✓ |
| Gateway sandbox contract tests (Razorpay/PayPal/Stripe test modes) | | ✓ | ✓ |
| Lighthouse CI | when `(marketing)` changed | ✓ | ✓ |
| gitleaks, `pnpm audit --prod`, CodeQL | ✓ | ✓ | ✓ |
| ZAP baseline (staging) | | ✓ | ✓ |
| k6 load (staging) | | weekly | ✓ |

CI runtime target: required PR checks ≤ 15 min. Emulators need Java (version per Firebase CLI — **verify**).

## 3. Environments, instances, and Firebase project separation

| Aspect | dev | staging | production (per instance) |
|--------|-----|---------|-----------|
| Firebase/GCP project | `crm-dev-*` | `crm-staging-<instance>` | `crm-prod-<instance>` |
| Billing plan | Blaze + low budget alert (A-14) | Blaze | Blaze + budgets |
| Firestore location | **US** (proposed `us-east1`) | = matching prod instance | chosen per instance (OQ-24) |
| Vercel | Preview deployments → dev project | `staging` environment (custom env / branch — verify) | Production deployment |
| Vercel function region | `iad1` (paired with `us-east1`) | paired | paired (e.g., `bom1` ↔ `asia-south1`) |
| Auth | Email/password, Google | same | same (Identity Platform later) |
| Domains | `*.app.dev.example.com` | `*.app.staging.example.com`, test custom domains | operator + agency + client domains |
| Payment gateways | test mode only | test mode only | live mode per agency |
| Data | synthetic | synthetic/UAT | real |
| PITR / backups | off | on | on (PITR + daily + weekly) |
| Human access | developers | developers | viewer by default; break-glass |
| Robots | noindex everything | noindex everything | per [07](07-seo-aeo-and-performance.md) |

Instance registry `instances/<name>.json` lists project IDs, Vercel project IDs, region, domains. Release workflows iterate the registry.

## 4. Configuration and secret management

- Non-secret config: Vercel environment variables per environment (Development/Preview/Staging/Production) managed as code via a sync script from `instances/<name>.json` + `config/<env>.json` (Vercel CLI/API — verify), never edited ad-hoc in the dashboard for production.
- Secrets: Vercel **sensitive** environment variables (not readable after creation) for platform secrets; Secret Manager for per-agency gateway secrets (runtime fetch) and Functions secrets (`defineSecret`).
- GCP access from Vercel: OIDC federation ([02 §5](02-system-architecture.md#5-firestore-and-admin-sdk-integration)); from CI: GitHub OIDC → WIF. Vercel deploy token for CI stored as GitHub secret, scoped to the team.
- Startup validation: `env.ts` Zod-parses env; fail fast; `NEXT_PUBLIC_*` allowlist.
- Full variable list: [12 §3](12-environment-and-configuration.md#3-environment-variables).

## 5. Deployment pipelines

```mermaid
sequenceDiagram
  participant Dev as Merge to main
  participant CI as GitHub Actions
  participant STG as Staging (each instance)
  participant H as Human approver
  participant PRD as Production (each instance)
  Dev->>CI: push main
  CI->>STG: firestore indexes (wait READY) → rules → storage rules → functions (Firebase CLI via WIF)
  CI->>STG: vercel deploy --prebuilt to staging env (web, console)
  CI->>STG: post-deploy smoke (synthetic agency/workspace, custom test domain, gateway test mode)
  CI->>CI: tag vX.Y.Z (release workflow, manual dispatch)
  CI->>H: GitHub Environment "production" approval + release checklist link
  H-->>CI: approve
  loop for each instance in registry
    CI->>PRD: verify backups healthy; record PITR timestamp
    CI->>PRD: indexes (wait READY) → migrations (expand, approved) → rules → functions
    CI->>PRD: vercel deploy --prebuilt --prod (web, console) of tagged commit
    CI->>PRD: smoke tests + health checks
    alt smoke fails
      CI->>PRD: vercel rollback / promote previous deployment; stop remaining instances; page on-call
    end
  end
```

Instances deploy sequentially (shared instance last or first per release risk — decided in the release plan); a failure halts the rollout.

## 6. Indexes, Security Rules, Functions, and migrations

| Artifact | Source | Deploy command (verify) | Safety |
|----------|--------|-------------------------|--------|
| Composite indexes | `firebase/firestore.indexes.json` | `firebase deploy --only firestore:indexes --project <alias>` | Additive; removals only via H4 |
| Firestore rules | `firebase/firestore.rules` | `firebase deploy --only firestore:rules` | Rules tests pass; H3 |
| Storage rules | `firebase/storage.rules` | `firebase deploy --only storage` | same |
| Functions | `functions/` | `firebase deploy --only functions` | Idempotent; region pinned to Firestore region |
| TTL policies | [03 §13](03-database-schema.md#13-retention-deletion-backups-recovery) | `gcloud firestore fields ttls update expireAt --collection-group=<cg> --enable-ttl` | One-time per project via infra script |
| Migrations | `functions/migrations/NNNN-*.ts` | `pnpm migrate --instance <name> --env <env> --id NNNN [--dry-run]` | Expand/contract; H4; per instance |
| Backup schedules | infra script | `gcloud firestore backups schedules create ...` (verify) | Verified in checklist |
| Vercel projects/domains config | `vercel.json`, sync script | Vercel CLI/API | H11 for domain automation changes |

## 7. Hosting and domain configuration

**[CONFIRMED] Vercel.** Key points to verify in T-01-09 (results recorded in ADR-007):
- Next.js 16 support (first-party), Node runtime version, function regions and max duration for webhook/export handlers.
- **OIDC federation to GCP** for Admin SDK (keyless).
- **Domains API**: add/verify/remove domains programmatically; per-project domain limits on the chosen plan; wildcard domains require Vercel nameservers.
- Deployment protection for previews; Firewall/WAF rules for rate limiting and console IP allowlist (plan-dependent).
- Log drains to Google Cloud Logging or another sink.

DNS plan (placeholders, OQ-16):
- `www.example.com` → Vercel `web`; apex 301 → www.
- `app.example.com` delegated to Vercel nameservers (or a sub-zone) to enable `*.app.example.com` wildcard.
- `console.example.com`, `partners.example.com` → Vercel `console`.
- `assets.example.com` → brand-assets bucket via Cloud CDN/load balancer, or served through a Vercel route proxying signed public objects (decide in T-01-09).
- `mail.example.com` → email provider (SPF, DKIM, DMARC, return-path); agency sender domains per FR-BRAND-005.
- Client custom domains: client adds CNAME (subdomain) or A/ALIAS (apex) per instructions from the domain wizard ([05 §5.1](05-white-label-and-multi-tenancy.md#51-custom-domain-onboarding-fr-ten-005-adr-022)).
- CAA records on operator domains; DNSSEC where supported.

## 8. Rollback

| Component | Rollback method | Time target |
|-----------|----------------|-------------|
| App (web/console) | Vercel instant rollback / promote previous production deployment (verify CLI `vercel rollback`) | ≤ 5 min |
| Functions | Redeploy previous tag's `functions/` | ≤ 15 min |
| Rules | Redeploy previous tag's rules | ≤ 5 min |
| Indexes | Not rolled back (additive) | — |
| Migrations | Forward-only; compensating migration or PITR document restore (H4/H8) | case-by-case |
| Config/secrets | Vercel env previous values (from config-as-code) / Secret Manager previous version | ≤ 10 min |
| Feature-level | Feature flag off (platform defaults) | ≤ 2 min (cache TTL 60 s) |
| Domain change | Re-set previous canonical host; re-add domain via API | ≤ 15 min + DNS |
| Gateway credentials | Restore previous Secret Manager version (agency owner informed) | ≤ 10 min |

Rule: app versions compatible with schema N and N−1 so app rollback never requires data rollback.

## 9. Backups and disaster recovery

| Mechanism | Configuration | Purpose |
|-----------|--------------|---------|
| Point-in-time recovery | Enabled in staging/prod (7-day window) | Recent mistakes (RPO ≈ minutes) |
| Scheduled backups | Daily (retain 7 d) + weekly (up to 14 weeks — verify) in prod | Longer horizon |
| Storage objects | Versioning on brand-assets bucket (30 d) | Asset recovery |
| Config | Instance registry, env config-as-code, infra scripts in repo | Rebuild |
| Auth users | Periodic `auth:export` to encrypted private bucket (restricted; 30-day retention; verify CLI) | Auth DR |
| Secret Manager | Versions retained; destroyed only on agency deletion | Gateway credential recovery |
| Billing state | Re-derivable from gateways via reconciliation job | Payment state DR |

**Targets:** RPO ≤ 1 h, RTO ≤ 4 h per instance (NFR-REL-002).

**Restore drill (T-10-04, quarterly after launch):** restore latest backup to new database in staging, run verification script (document counts per tenant vs. source, sample checksums), re-apply `erasureLog`, run payment reconciliation, measure duration, record results.

## 10. Monitoring and alerting

| Signal | Source | Alert threshold (initial) | Route |
|--------|--------|--------------------------|-------|
| Uptime: `www`, `console`, `partners`, sample workspace on platform host and on a custom domain, `/api/health` | External uptime checks (Cloud Monitoring or other) | 2 consecutive failures | Page |
| 5xx rate / function errors | Vercel observability + log drain metrics | > 2% for 5 min | Page |
| p95 latency (incl. Firestore round trip) | Logs | > 1.5 s for 10 min | Ticket/Slack |
| Error spikes | Sentry | new error type in prod; > 50/min | Slack; page > 200/min |
| Authz denials / cross-agency attempts | Log metric `authz.denied` by context | > 100/min, or > 20/min single uid | Security |
| Privileged logins from new devices | `privilegedSessions` alerts | every event (email) + daily digest | Security |
| Webhook signature failures | Log metric | > 10/min per agency | Security |
| Payment reconciliation drift | Function result | any drift | Billing ops |
| Domain verification errors / certificate expiry | Domain job + uptime SSL | any error > 24 h; < 21 days | Ops |
| Function failures / outbox dead letters | Functions metrics | > 0 dead / > 5% failure | Slack |
| Firestore usage & cost | Billing budgets | 50/80/100% | Email + Slack |
| Vercel usage (function invocations, bandwidth) | Vercel usage alerts / spend management (verify) | 80/100% | Email |
| Backup status | Script check | any failure | Page (business hours) |
| Email bounces/complaints | Provider webhooks | complaint rate > 0.1% | Security + ops |

Dashboards per instance: platform health, per-agency/per-workspace usage, security events, job/queue health, billing health.

## 11. Incident response

Severity: **SEV1** data exposure / cross-tenant or cross-agency leak, payment manipulation, privileged account compromise, or full outage · **SEV2** major feature down for many tenants · **SEV3** limited.

1. **Detect & declare** — on-call acknowledges, opens incident channel/doc, assigns Incident Commander.
2. **Contain** — rollback; flag off; suspend agency/workspace; revoke sessions (`revokeRefreshTokens`); rotate secrets (incl. affected agency gateway/webhook secrets); disable webhook route for an agency; block IPs via Vercel Firewall / rate limiter.
3. **Assess** — audit logs (tenant, agency, platform), Cloud Audit Logs, Vercel logs, gateway dashboards: scope, tenants, time window.
4. **Eradicate & recover** — fix forward or restore (PITR); reconcile payments; verify with isolation tests.
5. **Notify** — data incidents: legal/privacy lead within 24 h; affected agencies (processors) and through them clients (controllers) without undue delay; supports 72-h GDPR and DPDP timelines ([04 §16](04-security-and-compliance.md#16-privacy-and-compliance)).
6. **Postmortem** — blameless, within 5 business days; actions become tasks; threat model and tests updated (each incident adds a regression test).

Runbooks (T-11-06): cross-tenant/agency exposure · privileged account compromise · secret/gateway credential leak · webhook abuse · tenant/agency abuse (phishing/spam) · Firestore or Vercel cost spike · Vercel outage · domain hijack/dangling DNS · failed migration · backup restore.

## 12. Production release checklist

Short form; authoritative list in [13](13-release-readiness-checklist.md).
- [ ] Tag from green `main`; changelog reviewed.
- [ ] All RB tests green on the tagged commit (CI + each staging instance).
- [ ] Staging soak ≥ 24 h with no SEV2+.
- [ ] Migrations dry-run approved per instance (H4).
- [ ] Backups healthy; PITR timestamps recorded per instance.
- [ ] Indexes `READY` per instance.
- [ ] Gateway live-mode credentials validated for agencies going live (sandbox → live checklist).
- [ ] On-call assigned for 48 h.
- [ ] Rollback plan confirmed.
- [ ] Human approval in GitHub Environment (H6).
- [ ] Post-deploy smoke passed per instance; dashboards checked at +15 min, +1 h, +24 h.
