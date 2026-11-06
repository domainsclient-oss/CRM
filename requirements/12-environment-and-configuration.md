# 12 — Environment and Configuration

> **Prev:** [11 Roadmap](11-implementation-roadmap.md) · **Next:** [13 Release Readiness](13-release-readiness-checklist.md)
> v1.1 — Vercel hosting, US development region, multi-instance config, payment gateways, custom domains.
> All values below are **placeholders**. Never commit real secrets. Versions marked **(verify)** must be confirmed in T-01-01/T-01-09 and then pinned in `package.json` `engines`, `.nvmrc`, and `packageManager`.

## Contents

1. [Required tools and runtime versions](#1-required-tools-and-runtime-versions)
2. [Configuration naming conventions](#2-configuration-naming-conventions)
3. [Environment variables](#3-environment-variables)
4. [Firebase setup](#4-firebase-setup)
5. [Local development setup](#5-local-development-setup)
6. [Commands to define](#6-commands-to-define)
7. [Secret handling](#7-secret-handling)
8. [Onboarding checklist](#8-onboarding-checklist)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Required tools and runtime versions

| Tool | Version (to verify & pin) | Purpose |
|------|---------------------------|---------|
| Node.js | Active LTS — 24.x expected (verify Vercel and Cloud Functions runtime support) | Apps, functions, tooling |
| pnpm | 10.x (verify) via Corepack | Package manager |
| Next.js | 16.3.x (latest stable at time of T-01-01) | Framework |
| React | 19.x (as required by Next 16) | UI |
| TypeScript | 5.x latest stable (verify) | Types |
| Vercel CLI | Latest stable | Env sync, deploys, domains, rollback |
| Firebase CLI (`firebase-tools`) | Latest stable (verify) | Emulators, rules/index/functions deploys |
| Java JDK | **21 or newer** (confirmed: firebase-tools 15.x refuses older Java) | Emulators |
| Google Cloud CLI (`gcloud`) | Latest | IAM, WIF, TTL, backups, Secret Manager |
| Playwright | Latest stable + browsers | E2E |
| Git | ≥ 2.40 | VCS |
| Docker (optional) | Latest | Local Redis-compatible store for rate-limit tests |
| Gateway sandbox accounts | Razorpay test mode, PayPal sandbox, Stripe test mode | Payment integration tests |

## 2. Configuration naming conventions

| Prefix | Meaning | Exposed to browser |
|--------|---------|--------------------|
| `NEXT_PUBLIC_` | Public, non-secret client config (Firebase web config, public hostnames) | **Yes** — allowlisted names only |
| `APP_` | Server-side application settings | No |
| `FIREBASE_` / `GCP_` | Server-side Firebase/GCP settings (incl. federation config) | No |
| `*_SECRET`, `*_API_KEY`, `*_TOKEN`, `*_KEY` | Secrets — Vercel sensitive env vars or Secret Manager | No |
| `*_EMULATOR_HOST` | Emulator endpoints (local/CI only) | No |
| `TEST_` | Test-only flags; rejected by `env.ts` when `APP_ENV=production` | No |

Rules: SCREAMING_SNAKE_CASE; booleans `true|false`; durations suffixed with unit; one `env.ts` Zod schema per app is the single source of truth; unknown `NEXT_PUBLIC_*` names fail the build check. **Per-agency gateway credentials are never environment variables** — they live in Secret Manager, referenced from Firestore (FR-BILL-001).

## 3. Environment variables

| Variable | Scope | Secret | Example (placeholder) | Notes |
|----------|-------|:------:|----------------------|-------|
| `APP_ENV` | server | | `local` \| `dev` \| `staging` \| `production` | Drives safety checks |
| `APP_INSTANCE` | server | | `shared-us` | Instance name from `instances/` registry |
| `APP_MARKETING_HOST` | server | | `www.example.com` | |
| `APP_BASE_DOMAIN` | server | | `app.example.com` | Platform workspace subdomains |
| `APP_CONSOLE_HOST` | console | | `console.example.com` | |
| `APP_PARTNERS_HOST` | console | | `partners.example.com` | Agency console |
| `APP_ASSETS_BASE_URL` | server | | `https://assets.example.com` | |
| `APP_PLATFORM_STAFF_DOMAINS` | console | | `example.com` | Allowlisted Google Workspace domains (FR-AUTH-008) |
| `APP_CONSOLE_SESSION_MAX_AGE_HOURS` / `APP_PARTNERS_SESSION_MAX_AGE_HOURS` | console | | `8` / `12` | |
| `APP_CONSOLE_IP_ALLOWLIST` | console | | `203.0.113.0/24` (optional) | P2 |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | client | | `<firebase-web-api-key>` | Public; restrict key by HTTP referrer & API |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | client | | `<project-id>.firebaseapp.com` | |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | client | | `<project-id>` | |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | client | | `<app-id>` | |
| `FIREBASE_PROJECT_ID` | server | | `<project-id>` | |
| `GCP_PROJECT_NUMBER` | server | | `<project-number>` | WIF audience |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` / `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | server | | `vercel` / `vercel-oidc` | Vercel OIDC federation (verify config shape) |
| `GCP_SERVICE_ACCOUNT_EMAIL` | server | | `web-runtime@<project-id>.iam.gserviceaccount.com` | Impersonated via WIF |
| `FIREBASE_CLIENT_EMAIL` | server | | `<sa-name>@<project-id>.iam.gserviceaccount.com` | Service-account key auth: local dev or approved fallback (ADR-007); set together with the key |
| `FIREBASE_PRIVATE_KEY` | server | ✓ | `"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"` | `private_key` field of the JSON, `\n`-escaped; rotate 90 d; never in `.env.example` with a real value |
| `FIREBASE_STORAGE_PRIVATE_BUCKET` / `FIREBASE_STORAGE_BRAND_BUCKET` | server | | `<project-id>-private` / `<project-id>-brand-assets` | |
| `APP_SESSION_COOKIE_NAME` | server | | `__Host-session` | |
| `APP_SESSION_MAX_AGE_DAYS` | server | | `5` | 1–14 |
| `APP_REAUTH_WINDOW_SECONDS` | server | | `300` | |
| `APP_TENANT_CACHE_TTL_SECONDS` | server | | `60` | |
| `CURSOR_SIGNING_SECRET` / `CSRF_SECRET` / `UNSUBSCRIBE_SIGNING_SECRET` / `SESSION_BINDING_SECRET` | server | ✓ | `<sensitive env var>` | 32+ random bytes. `SESSION_BINDING_SECRET` must be identical in web and console (T-09-01 F-03); rotating it signs everyone out |
| `VERCEL_API_TOKEN` | console + functions | ✓ | `<sensitive env var / Secret Manager>` | Scoped to team/projects; domain management |
| `VERCEL_TEAM_ID` / `VERCEL_WEB_PROJECT_ID` | console + functions | | `<team-id>` / `<project-id>` | |
| `EMAIL_PROVIDER` | server/functions | | `resend` (production); `console` (local only) | OQ-06; Resend adapter is implemented |
| `EMAIL_PROVIDER_API_KEY` | functions | ✓ | Firebase Functions secret `EMAIL_PROVIDER_API_KEY` | Bound to `onMailQueued`; never put in `.env.local` or a committed env file |
| `EMAIL_FROM_ADDRESS` | functions | | `no-reply@mail.example.com` | |
| `PAYMENTS_ENABLED_PROVIDERS` | server | | `razorpay,paypal,stripe` | Feature switch per instance |
| `PAYMENTS_SECRET_PREFIX` | server | | `agy_` | Naming of per-agency secrets |
| `RATE_LIMIT_BACKEND` | server | | `redis` \| `memory` (local/test only) | |
| `SECRETS_BACKEND` | server | | `secret-manager` \| `local` (emulator only; rejected in staging/production) | Per-agency payment gateway secrets (Phase 6b) |
| `RATE_LIMIT_REDIS_URL` / `RATE_LIMIT_REDIS_TOKEN` | server | ✓ | `<sensitive env var>` | Upstash (OQ-07) |
| `SENTRY_DSN` | server/client | | `<dsn>` | OQ-11 |
| `LOG_LEVEL` | server | | `info` | `debug` forbidden in production |
| `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` / `FIREBASE_STORAGE_EMULATOR_HOST` | local/CI | | `127.0.0.1:8080` / `:9099` / `:9199` | Must be unset in hosted envs |
| `NEXT_PUBLIC_USE_AUTH_EMULATOR` | client local | | `true` | Rejected outside local/test |
| `TEST_FAULT_INJECTION` / `TEST_GATEWAY_MOCKS` / `TEST_VERCEL_DOMAINS_MOCK` | test | | `false` | Rejected in production |

Hosted email delivery requires `EMAIL_PROVIDER=resend` in the web and Functions environments and a verified `EMAIL_FROM_ADDRESS` in Functions. Set `EMAIL_PROVIDER_API_KEY` with `firebase functions:secrets:set EMAIL_PROVIDER_API_KEY --project <project-id>`; `onMailQueued` binds that secret. The local `console` provider only logs redacted delivery metadata and does not send to an inbox.

```dotenv
# .env.example — placeholders only; copy to .env.local for local development
APP_ENV=local
APP_INSTANCE=local
APP_MARKETING_HOST=www.localhost:3000
APP_BASE_DOMAIN=app.localhost:3000
APP_CONSOLE_HOST=console.localhost:3001
APP_PARTNERS_HOST=partners.localhost:3001
APP_PLATFORM_STAFF_DOMAINS=example.com
NEXT_PUBLIC_FIREBASE_API_KEY=demo-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-crm.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-crm
NEXT_PUBLIC_FIREBASE_APP_ID=demo-app-id
NEXT_PUBLIC_USE_AUTH_EMULATOR=true
FIREBASE_PROJECT_ID=demo-crm
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199
APP_SESSION_COOKIE_NAME=__Host-session   # note: __Host- requires https; local dev uses a non-prefixed fallback name set by env.ts when APP_ENV=local
CURSOR_SIGNING_SECRET=local-only-change-me
CSRF_SECRET=local-only-change-me
UNSUBSCRIBE_SIGNING_SECRET=local-only-change-me
RATE_LIMIT_BACKEND=memory
EMAIL_PROVIDER=console      # logs emails locally; rejected outside local/test
PAYMENTS_ENABLED_PROVIDERS=razorpay,paypal,stripe
TEST_GATEWAY_MOCKS=true
TEST_VERCEL_DOMAINS_MOCK=true
LOG_LEVEL=debug
```

## 4. Firebase setup

Per instance and environment (dev, staging, production), in T-01-09 / instance setup ([05 §3.1](05-white-label-and-multi-tenancy.md#31-instance-setup-once-per-instance)), with human approval:

1. Create GCP/Firebase project; **Blaze** plan with budget alerts (dev: low threshold, e.g., USD 10; free-tier quotas still apply — verify current Firestore/Storage free quotas and that new Storage buckets require Blaze, A-14).
2. Create the Firestore `(default)` database, Native mode, in the instance region. **Development: US — proposed `us-east1`** (close to Vercel `iad1`, and a region where Cloud Storage always-free usage applies — verify). Alternative: `nam5` multi-region (higher availability, higher cost). Enable PITR (staging/prod) and backup schedules (prod).
3. Firebase Authentication: enable Email/Password and Google providers; enable email enumeration protection if available without Identity Platform (verify); disable client-side sign-up if the setting is available (verify) — otherwise rely on server-only creation + orphan cleanup (FR-AUTH-001); authorized domains: operator hosts now, workspace hosts added by the domain job. **No Identity Platform upgrade for now** ([CONFIRMED]).
4. Cloud Storage: private bucket (uniform access, no public), brand-assets bucket (public-read IAM only, versioning 30 d), lifecycle rules.
5. Secret Manager: enable API; platform secrets for Functions; IAM so the console runtime SA can create/version `agy_*` secrets and web/functions SAs can only access them.
6. IAM & federation: runtime service accounts per app ([04 §6](04-security-and-compliance.md#6-firebase-admin-sdk-and-service-accounts)); Workload Identity Pool + provider for Vercel OIDC (per environment) and for GitHub Actions; org policy disabling SA key creation where possible.
7. Restrict Firebase web API key (HTTP referrers: operator hosts and `*.app.example.com`; custom domains added as they activate — verify referrer-restriction scale; API restrictions: Identity Toolkit, Token Service).
8. TTL policies on `expireAt` for collection groups listed in [03 §13](03-database-schema.md#13-retention-deletion-backups-recovery).
9. Cloud Functions region = Firestore region.
10. Monitoring: uptime checks, alert channels, Vercel log drain sink.

**Vercel setup** (per instance): projects `web` and `console` linked to the GitHub repo; Root Directory per app; function region paired with Firestore; environments (Preview → dev project, Staging, Production); deployment protection on previews; domains (operator hosts; `app.example.com` delegated for wildcard); OIDC federation enabled; env vars synced from config-as-code; spend management alerts.

`.firebaserc` aliases: `local` → `demo-crm`, `dev`, `staging-<instance>`, `prod-<instance>`.

**Emulators** (`firebase.json`): auth 9099, firestore 8080, storage 9199, functions 5001, emulator UI 4000. Vercel and gateways are mocked locally (`TEST_GATEWAY_MOCKS`, `TEST_VERCEL_DOMAINS_MOCK`); real sandbox calls only in nightly CI.

## 5. Local development setup

1. Install tools (§1); `corepack enable`.
2. `git clone` → `pnpm install`.
3. `cp .env.example apps/web/.env.local` and `apps/console/.env.local`.
4. `pnpm emulators` (Firebase emulators with `demo-crm`).
5. `pnpm seed` — creates platform staff, Agency One (Acme, Globex) and Agency Two (Initech), users for every role, two Members with disjoint records, domains in `active` state for local hosts, and mock gateway configs (local only).
6. `pnpm dev` → `http://www.localhost:3000` (marketing), `http://acme.app.localhost:3000` (workspace), `http://partners.localhost:3001` (agency console), `http://console.localhost:3001` (platform console). Simulated custom domains (`crm.acme.test`) need hosts-file entries.
7. Platform staff sign-in locally uses the Auth emulator's Google provider with an `@example.com` test account.
8. Run tests per §6.

## 6. Commands to define

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Run web + console dev servers |
| `pnpm emulators` / `pnpm seed` | Start Firebase emulators / seed fixtures |
| `pnpm build` | Build all apps & packages |
| `pnpm lint` / `pnpm format:check` / `pnpm typecheck` | Static checks |
| `pnpm test` | Unit + component tests |
| `pnpm test:integration` | Integration tests on emulators (incl. gateway & Vercel mocks) |
| `pnpm test:rules` / `pnpm test:functions` | Rules / Functions tests |
| `pnpm test:e2e` / `pnpm test:a11y` / `pnpm test:visual` | Playwright suites |
| `pnpm test:payments:sandbox` | Gateway contract tests against sandboxes (needs sandbox credentials; nightly CI) |
| `pnpm test:coverage` | Coverage with thresholds |
| `pnpm audit:deps` | `pnpm audit --prod --audit-level=high` |
| `pnpm check:indexes` / `pnpm check:isolation-registry` | Index coverage / action registries complete |
| `pnpm lighthouse` | Lighthouse CI locally |
| `pnpm env:sync --instance <name> --env <env> [--dry-run]` | Sync config-as-code to Vercel env vars |
| `pnpm migrate --instance <name> --env <env> --id <id> [--dry-run]` | Migration (non-local requires approval + human) |
| `pnpm instance:bootstrap --instance <name> --env <env>` | One-time platform-admin bootstrap (H8) |

## 7. Secret handling

- Never paste secrets into issues, PRs, chat, logs, or AI-agent prompts.
- Local development uses emulators and fake secrets only; no production credentials on developer machines; gateway **sandbox** credentials only in CI secrets for nightly tests.
- Platform secrets: Vercel sensitive env vars / Secret Manager; per-agency gateway secrets: Secret Manager only, entered through the agency console (write-only).
- If a secret leaks: rotate immediately (for gateway secrets, also rotate at the gateway dashboard and re-register the webhook secret), invalidate old version, search logs, follow incident runbook.
- `env.ts` refuses to start if placeholder values are present when `APP_ENV` is `staging`/`production`, or if `TEST_*` flags are set in production.

## 8. Onboarding checklist

- [ ] Read [00](00-project-overview.md), [02](02-system-architecture.md), [04](04-security-and-compliance.md), [05](05-white-label-and-multi-tenancy.md), [08](08-ai-agentic-development-workflow.md).
- [ ] Tools installed and versions match §1.
- [ ] Local setup §5 completed; `pnpm test`, `pnpm test:rules`, `pnpm test:e2e --grep smoke` green.
- [ ] GitHub access with 2FA; Vercel team access (least privilege); dev GCP project access only.
- [ ] Understands protected paths and human checkpoints (incl. H10 payments, H11 domains/instances).

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Emulators fail to start | Java missing/old; port in use | Install required JDK; change ports |
| App connects to real project locally | Emulator host vars missing | Set `*_EMULATOR_HOST`; `env.ts` blocks non-demo project IDs in `local` |
| `*.localhost` or `crm.acme.test` doesn't resolve | OS/browser resolution | Add hosts entries `127.0.0.1 acme.app.localhost crm.acme.test` |
| Admin SDK "could not load default credentials" on Vercel | OIDC federation misconfigured (audience, provider attribute conditions, SA impersonation binding) | Check WIF provider claims vs Vercel OIDC token; see T-01-09 spike notes |
| Session cookie not set locally | `__Host-` cookies require HTTPS | Use local fallback cookie name (env.ts) or local HTTPS |
| `FAILED_PRECONDITION: The query requires an index` (staging) | Missing composite index (often a Member own-scope variant) | Add to `firestore.indexes.json`; `pnpm check:indexes` |
| Google sign-in hidden/failing on a custom domain | Domain not yet in Firebase authorized domains | Check domain job status (`authDomainSynced`) |
| Custom domain stuck in `verifying` | DNS records missing/wrong, or domain attached to another Vercel account | Compare records shown in wizard with DNS; TXT verification for conflicts |
| Webhook returns 400 | Wrong webhook secret for agency, body parsed before verification, or test/live mismatch | Verify secret ref & mode; raw body handling |
| Server Action returns `FORBIDDEN` / `NOT_FOUND` for a Member | Own-scope: record owned by someone else | Expected behavior (FR-RBAC-004) |
| Build fails with server-only import error | Client component imports `packages/core` | Move logic to server action/query |
