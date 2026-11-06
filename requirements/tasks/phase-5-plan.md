# Phase 5 plan — White-label customization

Roadmap: [11 §Phase 5](../11-implementation-roadmap.md#phase-5--white-label-customization). Touches protected
paths (`packages/core/**`, `apps/*/src/proxy.ts`, `apps/*/next.config.ts`, `apps/web/src/app/api/**`,
`firebase.json`) → human review (H3) before merge. Domain changes are H11.

## Decisions

1. **Email provider: Resend (OQ-06, answered 2026-10-10), integrated later.** This phase ships the
   provider interface, branded HTML/text templates, subject/intro overrides, preview and test-send
   with the `console` provider. The Resend adapter and agency sender domains (T-05-08) follow.
2. **Brand assets are served same-origin** at `/api/brand/{scope}/{hash}.{ext}` on every host (web and
   console) from the brand bucket — no CSP change, works on custom domains. Emails use absolute URLs on
   the workspace's canonical host. Files are re-encoded with sharp, metadata stripped, content-hashed.
3. **Branding is resolved at read time** (platform → agency → workspace override if
   `allowWorkspaceBranding`), using the existing 60 s tenant/agency doc cache — meets the ≤ 60 s
   propagation AC without a trigger. Derived colors are computed server-side on save.
4. **Effective config** (plan template → agency caps → platform overrides → billing state) is resolved per
   request; limits are checked in the same transaction as the consuming write (records, seats). An
   expired trial or `read_only` billing state blocks mutations except billing.
5. **Domains** go through a `DomainProvider` interface: a deterministic mock (`TEST_VERCEL_DOMAINS_MOCK`)
   for local/test/E2E and a Vercel Domains API adapter whose endpoints are verified in T-01-09 before
   any real use. Authorized-domain sync uses the same pattern (mock + Identity Toolkit adapter).
   Verification is a callable "check now" plus a job body for the 10-minute scheduler (Functions, T-01-09).

## Work items

| Task | Deliverable |
|------|-------------|
| T-05-01 | Branding schemas, upload pipeline (magic-byte type check, size/dimension limits, sharp re-encode, content hash), asset route, workspace + agency branding pages, branded login |
| T-05-02 | `deriveTheme` (WCAG contrast, OKLCH lightness suggestion), CSS variables injected with the request nonce, live preview |
| T-05-03 | Mail provider interface, branded templates (escaped), overrides with allowlisted variables, preview + test send (10/day) |
| T-05-04 | Plan templates, effective config + feature flags, record/seat limits, read-only mode, powered-by badge, platform plan/override editor |
| T-05-05 | Usage page, 80 % / 100 % banners, `reconcileUsage` job body + script |
| T-05-06 | Inheritance resolution + `allowWorkspaceBranding` gate |
| T-05-07 | Domain service (add → verify → active → canonical → remove), proxy redirect from fallback host, agency base domains, console UI |
| T-05-08 | **Deferred** with the Resend integration |
| T-05-09 | Agency console: workspace detail (status, plan, seats, usage, domains, branding), agency branding, staff list/invite |
