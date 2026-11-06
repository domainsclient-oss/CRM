# AGENTS.md — rules for AI coding agents and contributors

Read this before changing anything. Full process: [requirements/08-ai-agentic-development-workflow.md](requirements/08-ai-agentic-development-workflow.md). Specification: [requirements/](requirements/). Task board: [requirements/tasks/STATUS.md](requirements/tasks/STATUS.md).

## What this is

Secure, multi-tenant, white-label CRM: operator → agencies (resellers) → client workspaces. Next.js 16 (App Router) on Vercel, Firebase Auth + Cloud Firestore. The browser never talks to Firestore directly; all data goes through server code using the Firebase Admin SDK, which **bypasses Security Rules** — so server-side authorization is the primary control.

> Next.js 16 differs from older versions. Before writing Next.js code, read the relevant guide in `apps/web/node_modules/next/dist/docs/` (see `apps/web/AGENTS.md`).

## Layout

| Path               | Purpose                                                                      |
| ------------------ | ---------------------------------------------------------------------------- |
| `apps/web`         | Marketing + workspace CRM (port 3000)                                        |
| `apps/console`     | Platform (`console.`) and agency (`partners.`) consoles (port 3001)          |
| `packages/core`    | **Server-only**: Firebase Admin, env validation, logger, errors, request IDs |
| `packages/shared`  | Isomorphic: error codes, `ActionResult`, i18n catalog, public env            |
| `packages/ui`      | Design system (shadcn/Radix, tokens) — apps import `@crm/ui/...`             |
| `packages/testing` | Fixtures (Agency One/Two, Acme/Globex/Initech) and emulator helpers          |
| `firebase/`        | Security Rules (deny-all in MVP), indexes, rules tests                       |
| `e2e/`             | Playwright suites                                                            |
| `requirements/`    | The plan — source of truth                                                   |

## Commands

```bash
pnpm dev                # web on :3000 (console: pnpm --filter console dev → :3001)
pnpm lint | pnpm typecheck | pnpm format:check
pnpm test               # unit + component (Vitest)
pnpm test:rules         # Security Rules on emulators (needs Java 21)
pnpm build && pnpm test:e2e:smoke
pnpm emulators          # Firebase emulators; pnpm seed loads fixtures
pnpm indexes:gen        # regenerate firestore.indexes.json from query shapes (--check in review)
```

Before claiming a task done, run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` (+ `pnpm test:rules` and E2E when relevant) and include the results.

## Non-negotiable rules

1. **Never trust the client** for tenant/agency IDs, roles, permissions, or ownership. Tenant comes from host + verified session + membership lookup on the server.
2. Firestore access only through `@crm/core` (lint-enforced). No `firebase-admin` imports in apps.
3. Every Server Action / Route Handler must authenticate, authorize, validate (Zod, server-side), and add an isolation test (from Phase 2: use the action wrappers).
4. Members see **only their own records**; Admin SDK reads must go through scoped repositories (Phase 3).
5. No `dangerouslySetInnerHTML` (lint-enforced). User-facing strings come from `@crm/shared/i18n`.
6. No caching of tenant data across requests; authenticated responses are `private, no-store`.
7. Never log PII, secrets, tokens, or record contents. Use `@crm/core/logger`.
8. Never commit `.env*` (except `.env.example` placeholders) or service-account keys.
9. Inspect existing code before editing; write a plan first for changes touching > 3 files or any protected path.
10. Don't weaken tests, thresholds, rules, or lint to get green. Don't change requirements to match code.

## Protected paths — require human approval (requirements/08 §7–8)

`firebase/*.rules`, `firebase/firestore.indexes.json`, `firebase.json`, `packages/core/**`, `apps/*/src/proxy.ts`, `apps/*/next.config.ts`, `apps/web/src/app/api/**`, `eslint.boundaries.mjs`, `.github/**`, `instances/**`, `vercel.json`. Also: auth/session code, payments, domain automation, migrations, IAM, production deploys.

## When stuck

Stop after 3 failed fix attempts, record findings in the task card, mark it `Blocked`. If requirements are ambiguous, add an open question to `requirements/00-project-overview.md §11` instead of guessing.
