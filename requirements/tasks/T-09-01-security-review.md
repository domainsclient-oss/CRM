# T-09-01 — Security review of protected areas

- Phase 9 · Requirements: NFR-SEC-001..011, [04](../04-security-and-compliance.md) · Date: 2026-10-10
- Reviewer: AI agent (Claude). **Needs human security sign-off** (roadmap Phase 9 completion criteria).
- Scope: proxies, session and auth code, Server Action wrappers, tenant/agency/platform contexts, scoped repositories, Route Handlers (`/api/**`), rate limiting, uploads/downloads, mail rendering, domains, logging, public marketing actions, Security Rules.

## 1. Summary

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| F-01 | **High** | The hosted rate-limit backend didn't exist. In staging or production every rate-limited endpoint (sign-in, invitations, every action) would have thrown. | Fixed |
| F-03 | **High** | Session cookies weren't bound to the host or surface they were issued for. A cookie captured on one host worked on any other host the user could access, including the consoles. | Fixed |
| F-08 | High (deploy) | CSV import allows 10 MB, but Vercel Functions accept at most 4.5 MB request bodies. Large imports would fail in hosted environments. | Open → OQ-26 |
| F-02 | Medium | The import upload Route Handler skipped the lifecycle gates (pending deletion, read-only), had no rate limit, and buffered bodies without a declared length. | Fixed |
| F-06 | Medium | Log redaction matched key names only. Emails or tokens inside values (e.g. third-party error messages) reached the logs. | Fixed |
| F-04 | Low | The "This wasn't me" link revoked sessions on GET, so mail scanners and link prefetchers could consume the single-use token. | Fixed |
| F-05 | Low | `/api/vitals` was a public, unthrottled endpoint that wrote log lines (cost). | Fixed |
| F-07 | Low | An unknown role value made authorization throw `TypeError` (still denied, but as a 500). | Fixed |
| F-09 | Low | Firebase revocation is second-granular: a session created in the same second as "sign out everywhere" survives it. | Accepted |
| F-10 | Info | Client IP for rate limits comes from `X-Forwarded-For`, which only Vercel's edge makes trustworthy. | Documented |
| F-11 | Info | `/api/health` is public and calls Firestore on every request. | Recommendation |

No Critical findings. Every fix has tests; the full suite is green (see §5).

## 2. Findings and fixes

### F-01 · High · Hosted rate limiting was not implemented

**Problem**
- `getRateLimiter()` threw for `RATE_LIMIT_BACKEND=redis`.
- The server environment forbids `memory` in staging and production.
- So every rate-limited call (session creation, invitations, every wrapped action) would have failed with a 500.
- Before this, no test exercised a hosted configuration.

**Fix:** `packages/core/src/rate-limit-redis.ts` adds an Upstash REST limiter.
- It uses the same sliding-window log as before, applied atomically with `MULTI/EXEC`, and needs no new dependency.
- Keys are SHA-256 hashed, so IP addresses and emails never reach the store.
- Refused hits aren't counted.
- Each call has a 1.5 s timeout.
- New variables: `RATE_LIMIT_REDIS_URL` (HTTPS only) and `RATE_LIMIT_REDIS_TOKEN`. Both are required when the backend is `redis`.

**Store-outage policy (needs owner confirmation)**
- Sign-in, public and invitation policies **fail closed**: the request is refused with a 500.
- Authenticated per-user limits **fail open** and log the outage: the default action policy, `mutation:uid`, downloads and vitals.
- A Redis outage therefore blocks sign-ins but not users who are already signed in.

**Tests:** `rate-limit-redis.test.ts` runs against a fake Upstash server. It checks limits and Retry-After, sliding windows, key hashing, error handling, and both outage modes.

### F-03 · High · Session cookies were not bound to surface and host

**Problem**
- A Firebase session cookie is valid project-wide. The membership check only asked whether *this user* belongs to *this host's* workspace.
- So a workspace cookie also worked:
  - on every other workspace host where the user is a member;
  - on the consoles, if the user also held a console role.
- Realistic exposure: an agency controls the DNS of its clients' custom domains. If it pointed a domain at its own server, it would receive the cookies of everyone signing in there — including platform staff who use that workspace — and could replay them on `console.` and `partners.`.

**Fix:** `packages/core/src/session.ts`.
- Each issued cookie is `firebaseCookie~HMAC(kind | host | firebaseCookie)`.
- `verifySession(cookie, { kind, host })` rejects cookies that are unbound, tampered with, or issued for another host or surface. The check is timing-safe and needs no extra Firestore read.
- New required secret `SESSION_BINDING_SECRET` (32+ characters in hosted environments, same value in web and console). Rotating it signs everyone out.
- Every caller now passes the request host:
  - the action wrappers;
  - the console access helpers;
  - sign-out;
  - the tenant, agency and platform contexts.

**Tests**
- `session.test.ts` (unit).
- `contexts.int.test.ts`:
  - a cookie replayed on another workspace where the user is a member is rejected;
  - a cookie replayed on the consoles is rejected;
  - unbound and tampered cookies are rejected.
- `e2e/isolation.spec.ts` replays a real browser cookie onto another workspace and onto `partners.`; both are rejected.

### F-02 · Medium · Import upload bypassed the action-wrapper gates

**Problem:** `POST /api/imports` checked CSRF, session and membership, but:
- didn't apply the pending-deletion and read-only gates that every tenant action applies;
- had no rate limit;
- trusted a missing `Content-Length` (the body was buffered before the size check).

**Fix**
- The gates are now one function, `assertWorkspaceState`, shared by the wrapper and the upload route.
- The upload route also:
  - requires a declared length;
  - checks `import.run` before reading the body;
  - is rate limited at `import-upload:uid`, 20 per hour.
- Downloads have a per-user limit (`download:uid`).

### F-08 · High (deployment) · Upload size exceeds the platform limit

**Problem:** FR-IMP-001 allows 10 MB CSVs, but Vercel Functions reject request bodies over 4.5 MB.

**Status:** not changed, because it's a product and architecture choice. It is recorded as **OQ-26**.
- Proposed answer: a signed, size-capped direct upload to the private bucket.
- Alternative: lower the limit to 4 MB.

**Blocks:** large imports on staging and production until decided.

### F-06 · Medium · Logs could carry PII inside values

**Problem**
- `redact()` replaced only values under sensitive key names.
- An `error.message` such as "There is no user record for raj@acme.test" or a token inside a provider error went to the logs as-is.
- `ip` and `userAgent` keys weren't redacted.

**Fix**
- Every string is scrubbed: messages, values and error messages. Emails become `[email]`, JWTs `[jwt]`, `Bearer`/`Basic` credentials and PEM private keys are removed.
- `ip`, `ipAddress` and `userAgent` keys are redacted.
- Tests (TC-OBS-001):
  - nested values, error objects and messages are scrubbed;
  - pseudonymous IDs (`requestId`, `tenantId`, `agencyId`, `uid`) are kept.

### F-04 · Low · "This wasn't me" revoked on GET

**Problem:** the alert email linked straight to `GET /api/auth/not-me?t=…`, which revoked all sessions. Mail security scanners and link prefetchers fetch such links, so they would sign the user out and burn the single-use token.

**Fix**
- The email now links to a confirmation page (`/not-me`, on both consoles).
- Revocation happens only on a same-origin `POST` from that page.
- Old links (GET) redirect to the page.
- The page sets `no-referrer`, so the token doesn't leak in Referer headers.

### F-05 · Low · Unthrottled public logging endpoint

`/api/vitals` now drops beacons beyond 30 per minute per IP (`vitals:ip`, fails open).

### F-07 · Low · Unknown roles raised TypeError

`workspaceScope`, `agencyAllows` and `platformAllows` now return "no access" for role strings outside the matrix, including `__proto__` and `constructor`. Tests cover this.

### F-09 · Low · Same-second revocation window (accepted)

- Firebase compares a session's `auth_time` with `tokensValidAfterTime` at one-second resolution.
- So a session created in the same second as a revocation stays valid.
- Exploiting this requires creating a fresh session (with the password) in that one-second window.
- Accepted. `load/revocation-latency.mjs` measures revocation outside that window: 39 ms locally.

### F-10 · Info · Client IP trust

- Rate-limit keys use the first `X-Forwarded-For` address, falling back to `X-Real-IP`.
- On Vercel these headers are set by the platform edge.
- Any other hosting must overwrite them at its edge, or IP limits can be bypassed by spoofing the header.
- Added to the deployment checklist (requirements/13).

### F-11 · Info · Health probe cost

- `/api/health` is public and runs `listCollections` on every call.
- Recommendation:
  - restrict it to uptime-check source ranges at the edge, or cache the result for about 10 s;
  - wire it in T-11-02.

## 3. Areas reviewed with no findings

| Area | What was checked |
|------|------------------|
| Proxies | `/t/*` internal rewrite unreachable on every host; unknown workspace hosts 404 before streaming; consoles not served by `web`; nonce CSP on workspace and console hosts, static CSP on marketing; robots and sitemap per host (Phase 8) |
| Session HTTP | CSRF header plus same-origin `Origin` on create and delete; strict body schema; cookies `HttpOnly`, `SameSite=Lax`, `__Host-` over HTTPS, no `Domain`; no cookie minted before authorization; rate limited per IP |
| Action wrappers | Origin required; strict schemas (smuggled `tenantId`/`role`/`ownerUid` rejected); permission checks; lifecycle gates; re-auth for sensitive actions; registry proves every exported action is wrapped (TC-SEC-002/004/011) |
| Contexts | Tenant from host plus verified session plus fresh membership read; agency selection validated against staff records; platform access requires Google, an allowlisted domain and a `platformAdmins` record |
| Repositories | Tenant paths only from server context; `assertSafeId`; owner scoping for Members; foreign-tenant, deleted and hidden records indistinguishable from missing (no existence oracle) |
| Domains | Platform hosts reserved exactly and the base domain as a suffix; ownership still requires DNS verification; cross-agency access returns NotFound |
| Files | Downloads require job visibility, a tenant path prefix and expiry; `Content-Disposition` sanitized; `nosniff` plus a sandbox CSP |
| Rendering | No `dangerouslySetInnerHTML` (lint); email templates escape all variables; JSON-LD serializer escapes `<`, `>`, `&`, U+2028/2029 and refuses non-marketing hosts; Markdown through SafeMarkdown only; CSV exports neutralize formulas |
| Public actions | Contact and find-workspace: strict schemas, honeypot, IP and address limits, identical answers whether or not an account exists |
| Security Rules | Deny-all, 120 rules tests; CI fails on `if true` |
| Client bundles | No server env names or key material in any browser bundle or prerendered payload (`pnpm scan:bundles`, TC-SEC-008) |

## 4. Not covered here (needs staging or an external party)

- **T-09-03 DAST:** `security/zap/run-baseline.sh` plus `zap-baseline.conf`, ready for staging. Fail on High (SAC-13).
- **T-09-06 Load:** `load/k6-mixed.js` (200 VUs, 15 min, p95 thresholds) and `load/revocation-latency.mjs`. See `load/README.md`.
- **T-09-07 External penetration test:** scope in [T-09-07-pentest-scope.md](T-09-07-pentest-scope.md).

## 5. Verification

The full results are recorded in STATUS.md (Phase 9). Coverage now meets every 09 §10 threshold, measured over unit, component, integration and registry runs together.
