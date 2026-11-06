# Phase 2 implementation plan — Authentication and tenant provisioning

Scope: T-02-01 … T-02-10 plus the Phase 3 foundations they depend on (T-03-01, T-03-02, T-03-04, T-03-06, T-03-07, T-03-08), per [11](../11-implementation-roadmap.md#phase-2--authentication-and-tenant-provisioning).
Protected paths touched: `packages/core/**`, `apps/*/src/proxy.ts`, `apps/*/src/app/api/**` → **human review (H3) before merge**.

## Design decisions (deviations from the plan text are marked ⚠)

1. **Framework-agnostic core.** `packages/core` never imports `next/*`. Contexts and services take `{ host, sessionCookie, origin }` as plain inputs; each app has a thin adapter (`src/server/request.ts`) that reads `headers()`/`cookies()`. Keeps core unit/integration-testable against emulators.
2. ⚠ **Internal rewrite segments** are `t/[host]` (web) and `platform/`, `agency/` (console) — `_`-prefixed folders are private in the App Router. The proxy returns 404 for direct requests to these prefixes.
3. **CSRF.** Server Actions: Next.js Origin/Host check **plus** wrapper-level check that an `Origin` header is present and same-host (Next lets Origin-less requests through). Session route handlers: same Origin check + required custom header `X-CRM-Request: 1` (forces CORS preflight cross-site; no CORS is ever allowed). ⚠ Replaces the planned double-submit token (equivalent protection per OWASP "custom request header" + origin verification; fewer moving parts).
4. **Sessions.** Admin `createSessionCookie` after `verifyIdToken(checkRevoked)`, `auth_time` ≤ 5 min, `email_verified`. Cookie name per host class: workspace `__Host-session` / console `__Host-console` / partners `__Host-partners` (plain names on `http://localhost`). Lifetimes: 5 d / 8 h / 12 h.
5. **Authorization source of truth** = Firestore membership/staff/platformAdmin docs read per request (ADR-006). No custom claims.
6. **Accounts** are created only by `acceptInvitation` (Admin `createUser`, emailVerified=true). No sign-up UI anywhere.
7. **Platform staff**: Google provider only + email domain allowlist (`APP_PLATFORM_STAFF_DOMAINS`) + `platformAdmins/{uid}`.
8. **Rate limiting**: `RateLimiter` interface; in-memory sliding window now (local/test), Redis adapter later (hosted envs already refuse `memory`).
9. **Email**: `mailOutbox` documents written in the same transaction; `EMAIL_PROVIDER=console` logs a redacted line. Real provider + Functions sender arrive with T-05-03.
10. **Tests**: new Vitest project `integration` runs inside `firebase emulators:exec` (auth + firestore) for services, contexts, wrappers, and isolation; unit tests for pure logic; Playwright E2E for login and invite flows runs against emulators.

## Slices (each ends green: format, lint, typecheck, unit, integration, rules)

| # | Slice | Tasks |
|---|-------|-------|
| A | `@crm/shared/permissions` + `@crm/core/authz` | T-03-01 |
| B | Hosts, session, contexts (tenant/agency/platform), scoped repository base | T-02-02, T-02-05, T-03-02 |
| C | Audit, rate limiter, action wrappers + registry | T-03-06, T-03-07, T-03-08 |
| D | Services: agency provisioning, workspace provisioning, invitations + account creation, password reset, privileged sessions + login alerts, orphan detection | T-02-04, T-02-09, T-03-04, T-02-03, T-02-10 |
| E | Web: proxy, login/reset/invite pages, session route, workspace shell, switcher, branded login | T-02-01, T-02-06, T-02-08 |
| F | Console: proxy, platform + agency sign-in, agencies/workspaces management, suspend/reactivate | T-02-07, T-02-09 |
| G | E2E flows on emulators, docs/STATUS/traceability updates | — |
