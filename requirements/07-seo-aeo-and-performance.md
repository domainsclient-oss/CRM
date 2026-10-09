# 07 — SEO, AEO, and Performance

> **Prev:** [06 UI/UX](06-ui-ux-and-responsive-design.md) · **Next:** [08 AI-Agentic Workflow](08-ai-agentic-development-workflow.md)
> **Core rule:** Only the operator's public marketing and documentation host is indexable. Tenant workspaces, login pages, the console, and all authenticated routes are never indexed and never appear in sitemaps or structured data.

## Contents

1. [Surface classification and index policy](#1-surface-classification-and-index-policy)
2. [Technical SEO for public pages](#2-technical-seo-for-public-pages)
3. [Structured data](#3-structured-data)
4. [AEO (Answer Engine Optimization)](#4-aeo-answer-engine-optimization)
5. [Preventing private data exposure](#5-preventing-private-data-exposure)
6. [Performance strategy](#6-performance-strategy)
7. [Performance budgets and acceptance criteria](#7-performance-budgets-and-acceptance-criteria)

---

## 1. Surface classification and index policy

| Surface | Host | Indexable | `robots.txt` | Headers / meta | Sitemap |
|---------|------|-----------|--------------|----------------|---------|
| Marketing pages | `www.example.com` | ✓ | `Allow: /`; `Disallow: /find-workspace`, `/api/` | `index, follow`; canonical | ✓ |
| Docs / help / FAQ | `www.example.com/docs` | ✓ | allowed | canonical | ✓ |
| Contact / Request a demo, find-workspace | `www.example.com/contact`, `/find-workspace` | contact ✓; finder ✗ | — | finder `noindex` | contact only |
| Legal pages | `www.example.com/legal/*` | ✓ (low priority) | allowed | canonical | ✓ |
| Workspace hosts (all paths incl. login): platform subdomains, agency-domain subdomains, **custom domains** | `*.app.example.com`, `*.crm.agency.example`, `crm.client.example` | ✗ | `User-agent: *` `Allow: /` *(so crawlers can see noindex)* — **see note** | `X-Robots-Tag: noindex, nofollow, noarchive` on **every** response + `<meta name="robots" content="noindex,nofollow">` | ✗ |
| Consoles | `console.example.com`, `partners.example.com` | ✗ | `Disallow: /` | `X-Robots-Tag: noindex, nofollow` | ✗ |
| Brand assets | `assets.example.com` | ✗ | `Disallow: /` | `X-Robots-Tag: noindex` | ✗ |
| API routes | any | ✗ | `Disallow: /api/` | `noindex` | ✗ |

**Note on tenant hosts:** blocking crawl via `robots.txt` prevents crawlers from seeing `noindex`, so a linked URL could appear in results without content. The proposed policy allows crawl but sends `noindex` on every response; authenticated pages redirect to login (which itself is `noindex`). Tenant subdomain discovery is further reduced by wildcard TLS certificates (no per-tenant Certificate Transparency entries) and by never linking tenant hosts from public pages. **[PROPOSED; owner may prefer `Disallow: /` — trade-off documented.]**

## 2. Technical SEO for public pages

| Item | Requirement |
|------|-------------|
| Rendering | Static generation (SSG) for marketing/docs; ISR for docs if content source is external |
| Metadata | Next.js Metadata API (`metadata`/`generateMetadata`): unique `<title>` (≤ 60 chars), `description` (≤ 155 chars), `alternates.canonical` absolute URL |
| Canonicals | `https://www.example.com/<path>` without trailing slash (or consistently with — pick one in T-08-03), lowercase; apex → www 301 |
| robots.txt | Host-aware Route Handler (`app/robots.txt/route.ts`) returning policy per §1 |
| Sitemap | `sitemap.xml` on www only, generated from route manifest + docs index; `lastmod` from content; excludes noindex pages; split if > 50,000 URLs |
| Open Graph / Twitter | `og:title`, `og:description`, `og:image` (1200×630, generated at build or static), `og:url`, `twitter:card=summary_large_image` |
| Headings | One `<h1>` per page; logical hierarchy |
| Links | Descriptive anchor text; internal linking between features ↔ docs ↔ pricing |
| Images | `next/image`, descriptive `alt`, modern formats, explicit dimensions |
| Status codes | 404 page with `noindex`; 301 for moved pages; no soft 404s |
| hreflang | Not in MVP (English only, A-07) |
| Analytics | Privacy-respecting, consent-gated; no analytics scripts on tenant hosts in MVP |

## 3. Structured data

JSON-LD on public pages only, generated from typed helpers and validated in CI (TC-SEO-002).

| Page | Schema types |
|------|-------------|
| Home | `Organization` (name, url, logo, sameAs), `WebSite` |
| Features | `SoftwareApplication` (applicationCategory `BusinessApplication`, operatingSystem `Web`) |
| Pricing | `SoftwareApplication` with `offers` (`Offer`/`AggregateOffer`: price, priceCurrency) — only real, current prices |
| Docs article | `TechArticle` or `Article` (headline, dateModified, author/publisher), `BreadcrumbList` |
| FAQ | `FAQPage` (questions visible on page verbatim). Note: Google limits FAQ rich results to certain authoritative sites; markup is still useful for answer engines and must exactly match visible content |
| Contact/About | `Organization`, `ContactPoint` |

Rules: no structured data on tenant/console hosts; never include tenant names, customer logos, or reviews unless real and permitted (no fabricated ratings).

## 4. AEO (Answer Engine Optimization)

Goal: make public content easy for search engines and AI answer engines to extract accurately.

| Practice | Implementation |
|----------|---------------|
| Question-led structure | Docs and FAQ headings phrased as real questions ("How do I import contacts from a CSV file?"); first sentence answers directly in ≤ 50 words, then details |
| Definitions | Glossary page (lead, deal, pipeline, lifecycle stage, workspace) with one-sentence definitions |
| Factual, verifiable claims | Specific numbers only when true (limits, file sizes, security practices); avoid superlatives; link to Security page for claims |
| Freshness signals | Visible "Last updated" date + `dateModified` in JSON-LD; changelog page |
| Entity consistency | Same product name, plan names, and terminology across pages and schema |
| Comparison & how-to content | Step lists with numbered steps; tables for plan comparisons |
| Crawlability | Server-rendered HTML (no client-only content for key text) |
| `llms.txt` | Optional, low-cost: plain-text index of public docs at `/llms.txt`. It is an emerging convention, not a standard — treat as experimental (P2) |
| Answer-engine crawlers | Policy decision (OQ): allow major AI crawlers on www (default allow) and block on all other hosts (they're `noindex`/`Disallow` anyway) |
| Measurement | Search Console, Bing Webmaster Tools; periodic manual checks of how answer engines describe the product |

Content governance: a docs page template with sections *Summary · Steps · Limits · Troubleshooting · Related* ensures consistent extractable structure.

## 5. Preventing private data exposure

| Vector | Control | Test |
|--------|---------|------|
| Search indexing of app pages | `X-Robots-Tag` on all tenant/console responses (set in proxy + headers config) | TC-SEO-001 |
| Sitemaps | Generated only on www host from static manifest; tenant hosts return 404 for `/sitemap.xml` | TC-SEO-001 |
| Metadata leaks | **[PROPOSED]** Authenticated pages may include the record name in `<title>` for usability (browser tabs/history are private and pages are `noindex`), but record data never appears in OG tags, structured data, or any metadata on unauthenticated responses (login page title = "Sign in · {AppName}") | TC-SEO-001 |
| Link unfurling (Slack/Teams) | No OG tags on tenant hosts; authenticated pages redirect bots to login (unfurl shows only app name) | TC-PUB-003 |
| Referrer leakage | `Referrer-Policy: same-origin` on app; external links `rel="noreferrer"` | TC-SEC-006 |
| Structured data | Disabled on tenant/console hosts (lint: JSON-LD helper throws if host class ≠ marketing) | TC-SEO-002 |
| Public brand assets | Content-hash names; no listing; contain only logos | Review |
| Error pages | No record data or tenant lists | TC-TEN-004 |
| Caching | `private, no-store` | TC-SEC-013 |

## 6. Performance strategy

| Area | Strategy |
|------|----------|
| Rendering | Server Components by default; client components small and leaf-level; streaming with Suspense for slow sections |
| Code splitting | Route-based automatic; `next/dynamic` for kanban DnD library, charts, import wizard CSV preview, color picker |
| Data | Parallel fetches (`Promise.all`) per page; request-scoped memoization; projections for lists; avoid N+1 by denormalization ([03](03-database-schema.md)) |
| Caching | Marketing static + CDN; app dynamic `no-store` ([02 §12](02-system-architecture.md#12-caching-strategy)) |
| Images | `next/image` with `sizes`; brand assets pre-sized (logo ≤ 512 px wide derivative, favicon set) |
| Fonts | System stack in app; self-hosted subset on marketing with `display: swap` |
| Third-party scripts | None on app; marketing analytics loaded after consent with `next/script` `lazyOnload` |
| Bundle hygiene | `@next/bundle-analyzer` in CI artifact; size-limit check per route; prefer `date-fns`/`Intl` over heavy libs; tree-shakable icon set |
| Server latency | Co-locate hosting region with Firestore location; Admin SDK instance reuse; min instances ≥ 1 in prod to reduce cold starts (cost trade-off) |
| Perceived performance | Optimistic updates on kanban/task completion with rollback; skeletons |

## 7. Performance budgets and acceptance criteria

| Metric | Public pages (p75, mobile, field/CrUX or lab Lighthouse "Slow 4G" profile) | App pages (lab, desktop + mobile) |
|--------|--------------------------------|-------------------|
| LCP | ≤ 2.5 s | ≤ 2.5 s on dashboard/list (seeded data) |
| INP | ≤ 200 ms | ≤ 200 ms for typing, filter changes, kanban move |
| CLS | ≤ 0.1 | ≤ 0.1 |
| TTFB | ≤ 600 ms (static) | p95 ≤ 800 ms server time (NFR-PERF-002) |
| Initial JS (gzip) | ≤ 150 KB | ≤ 250 KB |
| Lighthouse Performance score (lab) | ≥ 90 | ≥ 80 |
| Lighthouse SEO / Best Practices / Accessibility | ≥ 95 / ≥ 95 / 100 | n/a / ≥ 95 / ≥ 95 |
| Mutation round-trip | — | p95 ≤ 500 ms server |

Enforcement: Lighthouse CI on PRs touching marketing (assert thresholds), bundle-size check on all PRs, k6 load test pre-release (TC-PERF-002), production RUM via `web-vitals` reporting to logging endpoint (sampled, no PII) for public pages only.
