# T-11-03 — DNS, certificates and email authentication

Per instance, in production. Values come from `instances/<instance>.json` (domains) and the Vercel and email-provider dashboards. Check each record with `dig` (or Google Admin Toolbox) before ticking it.

## Operator domains

| Host | Record | Points to | Notes |
|---|---|---|---|
| `www.<domain>` | CNAME | Vercel (web project) | Marketing |
| apex `<domain>` | A / ALIAS | Vercel | Vercel redirects the apex to `www` with a 301 (07 §2) |
| `console.<domain>` | CNAME | Vercel (console project) | Platform console |
| `partners.<domain>` | CNAME | Vercel (console project) | Agency console |
| `app.<domain>` | **NS delegation to Vercel** | Vercel nameservers | Needed for the `*.app.<domain>` wildcard certificate. No per-tenant certificates means no tenant names in Certificate Transparency logs (07 §1) |
| `<domain>` | CAA | `0 issue "letsencrypt.org"` (plus Vercel's issuers if their docs list others), `0 iodef "mailto:security@<domain>"` | Only listed CAs may issue |

Add each host to **Firebase Auth → Authorized domains**. Platform hosts are added once. Workspace custom domains are added by `AuthDomainSync` when they activate.

## Client custom domains (FR-TEN-005)

The agency adds the domain in the partner console, and the client creates the records that the console shows:
- a subdomain gets a CNAME to `cname.vercel-dns.com`;
- an apex gets an A record to `76.76.21.21`;
- a `_vercel` TXT record proves ownership.

The domain check job (every 10 minutes) activates the domain. The agency then makes it the main address. For the pilot (T-10-02), activate at least one custom domain and one agency subdomain.

## Email (Resend, OQ-06)

| Record | Purpose |
|---|---|
| SPF `v=spf1 include:<provider SPF> ~all` on the sending domain | Authorize the provider |
| DKIM CNAME/TXT records from the provider dashboard | Signature |
| DMARC `_dmarc` TXT `v=DMARC1; p=quarantine; rua=mailto:dmarc@<domain>; adkim=s; aspf=s` | Start with `p=none` for one week, then move to `quarantine` |
| Return-path / bounce domain (if the provider uses one) | Bounce handling |

Agency sender domains (T-05-08) are deferred until the Resend adapter ships.

## Verify

| Check | Command / expected |
|---|---|
| TLS + HSTS on all four hosts | `pnpm` release smoke (`scripts/smoke-deploy.mjs`) passes (TC-SEC-014) |
| Wildcard works | `https://<random>.app.<domain>/` returns 404 with a valid certificate (TC-TEN-008) |
| Email passes | A test invitation shows `spf=pass dkim=pass dmarc=pass` in the headers |
| CAA | `dig CAA <domain>` lists only the intended CAs |
