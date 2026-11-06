# T-01-09 — Cloud provisioning + platform verification spike

- Phase: 1 · Owner: project owner (accounts, billing, IAM) + DevOps agent · Reviewer: Architect, Security
- Requirements: NFR-PRIV-001, NFR-SEC-007, NFR-PERF-002, R-02, R-10
- Status: **Blocked — needs owner actions below** (agents cannot create accounts, billing, or IAM)
- Human checkpoints: H2 (if any ADR changes), H9 (IAM / federation)

## Already verified in the repo (2026-10-09)

| Item | Result |
|------|--------|
| Next.js version | 16.4.0 installed (plan said 16.3) |
| `proxy.ts` | Replaces `middleware`; **Node.js runtime only**; Server Functions are not separate routes → authorize inside every action (matches 02 §3) |
| Route Handlers + Cache Components | `cacheComponents` is on by default; GET handlers can prerender → call `connection()` for per-request handlers (done in `/api/health`) |
| Firebase Admin SDK | 14.5.0; `initializeFirestore(app, { preferRest: true })` available (used) |
| Firebase CLI | 15.33.0 — **requires Java 21+** for emulators |
| Vitest / Playwright | 5.0.3 / 1.64.0 |
| Firestore connection | Works from local dev against the owner's dev project via service-account key |

## Owner actions

1. [ ] **Install JDK 21** locally (e.g. `winget install EclipseAdoptium.Temurin.21.JDK`) → run `pnpm test:rules` and `pnpm emulators` + `pnpm seed`.
2. [ ] **Confirm the dev Firebase project's Firestore location** (Firebase console → Firestore → Settings). Plan proposes `us-east1`. Location is immutable.
3. [ ] **Create the staging project** in the same region; Blaze plan + budget alert.
4. [ ] **Create the GitHub repository**, push `main`, enable branch protection (required checks: `CI / quality`, `CI / rules`, `CI / e2e`, `CI / secrets`, `CodeQL`), enable secret scanning + push protection, confirm the CODEOWNERS handle.
5. [ ] **Create Vercel projects** `web` (root `apps/web`) and `console` (root `apps/console`) on the chosen plan; function region `iad1`.
6. [ ] Share (non-secret) project IDs → fill `instances/shared-us.json`.

## Agent verification once accounts exist

- [ ] Vercel OIDC → GCP Workload Identity Federation for the Admin SDK (no key file); fallback decision recorded in ADR-007.
- [ ] Vercel Domains API: add / verify / remove domain, per-project domain limits on the plan, wildcard requirement (nameservers) for `app.<domain>`.
- [ ] Cookie behaviour on Vercel for `__Host-session`.
- [ ] Vercel log drain → chosen sink; Vercel Firewall rate-limit availability on the plan.
- [ ] Firebase Auth authorized-domains update via API **without** Identity Platform; maximum number of domains (R-02).
- [ ] Firestore composite-index limit for the project (plan needs ≈ 90).
- [ ] Blaze/free-tier facts for A-14 (Functions and new Storage buckets require Blaze?).
- [ ] Enable `release.yml` deploy steps; set `DEPLOY_ENABLED=true` only after a successful staging deploy.

## Deliverable
Spike report appended here; ADR-007 / ADR-022 / 02 §4.5 updated if findings differ (H2).
