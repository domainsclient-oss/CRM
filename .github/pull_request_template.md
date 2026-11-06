## Task

- Task ID: T-
- Requirements: FR- / NFR-
- Plan (required for > 3 files or protected paths): <!-- link -->

## Summary

<!-- 3–5 bullets -->

## Tests

- Test IDs added/updated: TC-
- Commands run and results:
  - [ ] `pnpm format:check`
  - [ ] `pnpm lint`
  - [ ] `pnpm typecheck`
  - [ ] `pnpm test`
  - [ ] `pnpm test:rules` (if rules/data access touched)
  - [ ] `pnpm test:e2e:smoke` (if UI touched)

## Security checklist (requirements/08 §9)

- [ ] Tenant/agency context derived server-side; no tenantId/role/ownerUid accepted from input
- [ ] Every new Server Action / Route Handler authenticates, authorizes, validates, and has an isolation test
- [ ] No PII/secrets in logs; no `dangerouslySetInnerHTML`
- [ ] New query shapes have indexes
- [ ] Protected paths touched? If yes, human approval recorded: <!-- link -->

## UI (if applicable)

- [ ] Screenshots: mobile + desktop
- [ ] Keyboard path and focus checked; no new axe violations

## Handoff

<!-- files touched by layer, interface changes, decisions, follow-ups, traceability updates -->
