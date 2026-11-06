# Phase 8 plan — SEO, AEO, and performance

Roadmap: [11 §Phase 8](../11-implementation-roadmap.md#phase-8--seo-aeo-and-performance-optimization). Spec: [07](../07-seo-aeo-and-performance.md).

| Task | Work |
|------|------|
| T-08-01 | Marketing route group: Home, Features, For agencies, Plans, Security, About, Contact (demo request), Find your workspace, Legal (privacy, terms, cookies — **drafts for counsel**). Static generation; copy in `@crm/shared/content` |
| T-08-02 | Docs (question-led articles: Summary · Steps · Limits · Troubleshooting · Related), FAQ (`FAQPage`), glossary, client-side docs search, `llms.txt` |
| T-08-03 | Metadata (title ≤ 60, description ≤ 155, canonical), OG image (`next/og`), JSON-LD helpers that refuse non-marketing hosts, `robots.txt`/`sitemap.xml` on the marketing host |
| T-08-04 | Index policy in the proxies: workspace hosts `Allow: /` + `noindex` on every response; consoles `Disallow: /`; `sitemap.xml` 404 off the marketing host; tests (TC-SEO-001) |
| T-08-05 | Budgets as tests: initial JS (gzip) ≤ 150 KB public / ≤ 250 KB app, Lighthouse (perf ≥ 90, SEO ≥ 95, BP ≥ 95, a11y 100 on public pages) via `pnpm perf:lighthouse`; RUM (`web-vitals`, sampled, public pages only) |
| T-08-06 | Cost review against read budgets (03 §11) + billing-alert runbook (alerts themselves need the GCP project, T-01-09) |

Decisions: brand name stays the placeholder `CRM` (OQ-16); the plans page shows entitlements but **no prices** (agencies set prices, OQ-25 — 07 §3 allows only real prices), so no `Offer` markup; AI crawlers allowed on www (07 §4 default).
