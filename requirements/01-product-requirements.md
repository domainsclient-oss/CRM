# 01 — Product Requirements

> **Prev:** [00 Overview](00-project-overview.md) · **Next:** [02 Architecture](02-system-architecture.md)
> Requirement IDs here are referenced by [11 Roadmap](11-implementation-roadmap.md), [09 Tests](09-testing-and-quality-assurance.md), and [14 Traceability](14-traceability-matrix.md). Do not renumber; deprecate instead.

## Contents

1. [Conventions](#1-conventions)
2. [Authentication (AUTH)](#2-authentication-auth)
3. [Tenancy (TEN)](#3-tenancy-ten)
4. [Roles, Team & Permissions (RBAC)](#4-roles-team--permissions-rbac)
5. [Common Record Behavior (REC)](#5-common-record-behavior-rec)
6. [Companies (COM)](#6-companies-com)
7. [Contacts & Customers (CON)](#7-contacts--customers-con)
8. [Leads (LEAD)](#8-leads-lead)
9. [Deals & Pipeline (DEAL)](#9-deals--pipeline-deal)
10. [Tasks (TASK)](#10-tasks-task)
11. [Activities & Communication (ACT)](#11-activities--communication-act)
12. [Dashboard (DASH)](#12-dashboard-dash)
13. [Search, Filtering, Sorting (SRCH)](#13-search-filtering-sorting-srch)
14. [Reporting (RPT)](#14-reporting-rpt)
15. [Notifications (NOTF)](#15-notifications-notf)
16. [Import / Export (IMP)](#16-import--export-imp)
17. [Branding (BRAND)](#17-branding-brand)
18. [Settings (SET)](#18-settings-set)
19. [Plans, Limits & Entitlements (PLAN)](#19-plans-limits--entitlements-plan)
20. [Audit Log (AUD)](#20-audit-log-aud)
21. [Privacy (PRIV)](#21-privacy-priv)
22. [Public Site (PUB)](#22-public-site-pub)
23. [Field Validation Reference](#23-field-validation-reference)
24. [Agencies / Resellers (AGY)](#24-agencies--resellers-agy)
25. [Billing & Payments (BILL)](#25-billing--payments-bill)

---

## 1. Conventions

- Each requirement: **ID · Priority · Status label · Description · Acceptance Criteria (AC)**.
- AC use Given/When/Then shorthand. Every AC is testable and mapped to a `TC-*` in [09](09-testing-and-quality-assurance.md#12-test-case-catalog).
- "Authorized user" means: authenticated, email-verified, active member of the current workspace (tenant), workspace and its agency status `active`, holding the named permission ([§4.3](#43-permission-matrix)). Agency staff are authorized by agency staff records ([§24](#24-agencies--resellers-agy)), never by workspace membership.
- "Workspace host" means any host mapped to a workspace: platform subdomain, agency-domain subdomain, or custom domain ([05 §5](05-white-label-and-multi-tenancy.md#5-domains-and-routing)).
- All mutations are audited ([§20](#20-audit-log-aud)) unless stated otherwise.
- All lists use cursor pagination with default page size 25, max 100.
- Error UX standard: field errors inline + error summary; server errors show a generic message with a support reference (`requestId`), never stack traces.

---

## 2. Authentication (AUTH)

### FR-AUTH-001 · P0 · Email/password sign-in with verification; account creation only via invitation
**[CONFIRMED]** There is no public sign-up. A Firebase Auth account is created **server-side** (Admin SDK) only while accepting a valid invitation (workspace member, workspace owner, or agency staff). Unverified users cannot access data.

**AC**
1. Given a valid invitation for an email with no account, when the invitee sets a password meeting policy (≥ 12 chars, max 128, checked against a common/breached-password list), then the server creates the account, marks the email verified (the invite link proves mailbox control), and creates the membership in the same flow.
1a. Accounts created outside this flow (e.g., direct calls to the Firebase Auth REST API) have no membership and therefore no access; a daily job flags such orphan accounts for deletion.
2. Given an unverified user, when they access any `/app` route, then they are redirected to a "verify your email" screen with a resend action (rate-limited: 1/min, 5/hour).
3. Given wrong credentials, then a generic error "Email or password is incorrect" is shown (no user enumeration).
4. Password fields allow paste and password managers (WCAG 3.3.8).

### FR-AUTH-002 · P1 · [PROPOSED] Google sign-in
**AC**
1. Given Google sign-in on a workspace host that is a Firebase-authorized domain, when OAuth completes, then a session is established exactly as in FR-AUTH-004; on hosts not (yet) authorized, the Google button is hidden.
2. Given a Google account whose email matches an existing email/password account, then account linking follows Firebase "one account per email" setting; no duplicate users are created.
3. Google-verified emails count as verified.

### FR-AUTH-003 · P0 · Password reset
**AC**
1. Given any email entered in "Forgot password", then the same confirmation message appears whether or not the account exists.
2. Reset links expire per Firebase default (verify) and are single-use; reset email is tenant-branded when initiated from a tenant host (FR-BRAND-003).
3. After a successful reset, all existing sessions for that user are revoked (FR-AUTH-006).

### FR-AUTH-004 · P0 · Server-side session cookie
After client sign-in, the client exchanges a fresh ID token for an **httpOnly session cookie** created by the Firebase Admin SDK. Server code authorizes using only this cookie.

**AC**
1. Cookie attributes: `HttpOnly; Secure; SameSite=Lax; Path=/`; host-only (no `Domain`); lifetime configurable 1–14 days (default 5 days).
2. Session creation requires an ID token issued < 5 minutes ago (`auth_time` check) and a same-origin request with CSRF protection.
3. Tampered, expired, or revoked cookies result in redirect to login (pages) or `401` (route handlers).
4. Client-side Firebase Auth persistence is set to none/in-memory after the exchange so no long-lived refresh token remains in browser storage.
5. Sensitive operations (ownership transfer, tenant deletion, full export, role change to Admin/Owner) require re-authentication within the last 5 minutes.

### FR-AUTH-005 · P3 · MFA (TOTP) for privileged and workspace users — post-MVP
**[CONFIRMED]** Deferred: requires upgrading to Google Cloud Identity Platform (OQ-10). When adopted: mandatory for platform and agency staff, optional/enforceable per workspace. Until then FR-AUTH-008 applies.

### FR-AUTH-006 · P0 · Sign-out and session revocation
**AC**
1. "Sign out" clears the cookie and revokes refresh tokens for this user (signs out all devices — documented in UI).
2. Owners/Admins can force sign-out of a member (revokes that user's tokens) — audited.
3. Disabled users and revoked sessions are rejected on the next mutation and next full page load (verification with `checkRevoked=true`).

### FR-AUTH-007 · P3 · Enterprise SSO (SAML/OIDC) per tenant — post-MVP.

### FR-AUTH-008 · P0 · Privileged-account protections (compensating controls while MFA is deferred)
Applies to platform staff (console) and agency staff (agency console).

**AC**
1. Platform staff sign in **only with Google** using accounts from an allowlisted operator Google Workspace domain (`hd`/email-domain check server-side); the operator enforces 2-Step Verification in its Google Workspace admin policy (organizational control, recorded in the release checklist).
2. Agency staff sign in with Google (allowlisted agency domain, if the agency has one) or email/password with policy from FR-AUTH-001.
3. Console session lifetime ≤ 8 h (platform) / ≤ 12 h (agency), separate host-only cookies; re-authentication within 5 min required for: creating/suspending/deleting agencies or workspaces, changing gateway credentials, adding domains, changing staff roles.
4. Login-alert email on every new privileged session (new IP/user agent) with "this wasn't me" link that revokes all sessions.
5. Optional IP allowlist for the platform console (Vercel Firewall rule or app-level check, P2).
6. Stricter rate limits on privileged sign-in (see [04 §9](04-security-and-compliance.md#9-rate-limiting-and-abuse-prevention)).

---

## 3. Tenancy (TEN)

### FR-TEN-001 · P0 · Operator-provisioned workspaces (no public signup)
**[CONFIRMED]** Workspaces are created by platform staff (and by agency admins only if the agency has entitlement `agency.canProvisionWorkspaces`, OQ-22).

**AC**
1. Given an authorized provisioner, when they submit agency (fixed for agency admins), workspace name, slug, plan, initial host(s) and owner email, then (in one transaction) the workspace, slug reservation, default host mapping, default pipeline, default settings, plan/subscription record, usage counters, owner invitation, and audit entries are created.
2. The owner receives a branded invitation to the workspace host; accepting it creates the account (FR-AUTH-001) and the Owner membership.
3. Agency quotas (`maxWorkspaces`, `maxSeatsTotal`) are enforced in the provisioning transaction.
4. Provisioning is idempotent (retry with the same client idempotency key does not create duplicates).
5. No public route can create workspaces or accounts (TC-TEN-001 asserts absence).

### FR-TEN-002 · P0 · Suspension and reactivation (platform and agency)
**AC**
1. Platform Super Admin can suspend/reactivate any workspace or agency; Agency Owner/Admin can suspend/reactivate workspaces of their own agency (e.g., non-payment). Suspending an agency suspends all its workspaces.
2. Suspending a tenant: within ≤ 60 s all members see a "workspace suspended" page; all mutations return `403 TENANT_SUSPENDED`; scheduled jobs for the tenant skip; data is retained.
3. Reactivation restores access. All actions audited at platform level.

### FR-TEN-003 · P0 · Unique, safe tenant slug
**AC**
1. Slug: 3–40 chars, `^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$`, no consecutive hyphens.
2. Reserved list rejected (e.g., `www, app, api, admin, console, assets, auth, mail, status, docs, help, support, billing, static, cdn, login, signup`).
3. Concurrent requests for the same slug: exactly one succeeds (transaction on `tenantSlugs/{slug}`).
4. Slug changes are P3 (not in MVP) because they change hostnames.

### FR-TEN-004 · P1 · Host-based tenant resolution
**AC**
1. Requests to any workspace host (platform subdomain, agency-domain subdomain, verified custom domain) resolve the workspace via `tenantDomains/{host}`; unknown or unverified hosts return a neutral 404 that reveals no tenant names.
2. Host resolution only determines *which* tenant is targeted; access is still granted only by membership (NFR-SEC-002).
3. A user who is a member of tenant A but visits tenant B's host sees "You don't have access to this workspace" with no tenant B data beyond its public branding.

### FR-TEN-005 · P1 · Custom domains per workspace (at launch)
**[CONFIRMED]** Workspaces can be served on a client-owned domain (e.g., `crm.acme.example`). Design in [05 §5](05-white-label-and-multi-tenancy.md#5-domains-and-routing).

**AC**
1. Platform staff or agency admins add a domain to a workspace; the system registers it with the hosting provider (Vercel Domains API) and shows the exact DNS records (CNAME/A and ownership TXT) to configure.
2. Domain becomes active only after DNS ownership verification and TLS issuance succeed; status is visible (`pending_dns`, `verifying`, `active`, `error`).
3. On activation the domain is added to Firebase Auth authorized domains (R-02) and becomes the canonical host for that workspace's emails and links; the platform subdomain redirects (301) to it.
4. A domain can map to only one workspace across the instance; removing a domain detaches it from hosting and authorized domains and is audited.
5. Apex domains and subdomains are both supported (subdomain recommended — apex needs A/ALIAS records).

### FR-TEN-006 · P0 · Tenant deletion
**AC**
1. Only the Owner (with recent re-auth) can request deletion, confirming by typing the slug.
2. Tenant enters `pending_deletion` for 30 days: access blocked for members, Owner can cancel.
3. After 30 days, a purge job deletes all tenant documents, subcollections, storage objects, auth memberships, domain mappings; slug is quarantined 90 days.
4. A minimal platform-level tombstone (tenantId, deletion date, requester uid) is retained for audit.
5. Purge is verified by a post-purge check that zero documents remain under `tenants/{tenantId}`.

### FR-TEN-007 · P1 · Full tenant data export
**AC**
1. Owner can request a full export (JSON per collection + CSV for CRM entities) as a background job.
2. Download via a signed URL valid 24 h, accessible only after authenticating as Owner; file deleted after 7 days.
3. Export contains only the requesting tenant's data (TC-TEN-006).

### FR-TEN-009 · P1 · Agency domains with workspace subdomains
**AC**
1. An agency may register a base domain (e.g., `crm.agency-one.example`); workspaces of that agency can then be served at `{slug}.crm.agency-one.example`.
2. Wildcard serving requires the agency domain's DNS to be delegated as required by the hosting provider (Vercel requires its nameservers for wildcard domains — verify); otherwise each workspace subdomain is added individually as in FR-TEN-005.
3. Every workspace always also has a platform fallback host `{slug}.app.example.com` (redirecting to its canonical host).

### FR-TEN-008 · P1 · Multiple workspace membership
**AC**
1. A user can be a member of several tenants; a workspace switcher lists only tenants where membership status is `active`.
2. Switching navigates to the other tenant's host; access requires a session on that host and active membership.

---

## 4. Roles, Team & Permissions (RBAC)

### FR-RBAC-001 · P0 · Invitations
**AC**
1. Owner/Admin invites by email + role (cannot invite as Owner; Admin cannot invite Admin — only Owner can). Sole exception: the platform-admin console may invite the initial Owner of a tenant it provisioned (FR-TEN-002).
2. Invitation token: 256-bit random, stored as SHA-256 hash; expires after 7 days; single-use; revocable.
3. Acceptance requires signing in with the invited email (case-insensitive match) and verified email.
4. Seat limit enforced server-side at invite and at acceptance (FR-PLAN-001).
5. Invite email rate limit: 50/tenant/day; re-send ≤ 3 per invite.

### FR-RBAC-002 · P0 · Built-in roles and permission matrix
Five tenant roles: **owner, admin, manager, member, viewer**. Permissions are defined in code (versioned) — see [§4.3](#43-permission-matrix).

**AC**
1. Every Server Action / Route Handler declares a required permission; enforcement is server-side.
2. UI hides actions the user lacks, but hiding is never the control.
3. Table-driven tests cover every role × permission (TC-RBAC-002).

### FR-RBAC-003 · P0 · Role changes and member removal
**AC**
1. Owner can change any non-owner role; Admin can change roles among manager/member/viewer.
2. Nobody can change their own role.
3. Removing a member immediately blocks access (next request), revokes their sessions if they have no other memberships, and reassigns their open records to a chosen member (required step).
4. There is always exactly one Owner.

### FR-RBAC-004 · P0 · Record ownership and Member own-only visibility
**[CONFIRMED]** Members see only their own records.

**AC**
1. Every CRM record has `ownerUid` (tasks: `assigneeUid`). A Member can **read, list, search, report on, export, edit, and delete only** records they own and tasks assigned to them; activities are visible to a Member when attached to a record the Member can see.
2. Lists, search, dashboards, reports, kanban, notifications, and exports for Members are built with a mandatory `ownerUid == uid` filter added by the repository layer (never by the UI).
3. Opening another user's record by URL returns 404. Related records the Member cannot see are shown as a plain label (snapshot name) without link or details.
4. Duplicate checks (FR-CON-003, FR-COM-003) tell a Member only that "a matching record exists and is owned by another user — ask a manager"; no field values are revealed.
5. When a Manager reassigns a record away from a Member, the Member loses access on the next request.
6. Managers, Admins, Owners, and Viewers see all records of the workspace; Viewers cannot mutate.

### FR-RBAC-005 · P3 · Teams/groups — post-MVP.
### FR-RBAC-006 · P3 · Custom roles — post-MVP.

### FR-RBAC-007 · P1 · Ownership transfer
**AC**
1. Owner transfers ownership to an active Admin with recent re-auth; previous Owner becomes Admin.
2. Transaction ensures exactly one Owner; both users notified by email.

### 4.3 Permission matrix

`✓` allowed · `own` own/assigned records only · `—` denied.

| Permission | owner | admin | manager | member | viewer |
|-----------|:----:|:----:|:----:|:----:|:----:|
| `record.read` (companies, contacts, leads, deals, tasks, activities) | ✓ | ✓ | ✓ | own | ✓ |
| `record.create` | ✓ | ✓ | ✓ | ✓ | — |
| `record.update` | ✓ | ✓ | ✓ | own | — |
| `record.delete` (soft) | ✓ | ✓ | ✓ | own | — |
| `record.restore` / `record.purge` | ✓ | ✓ | ✓ | — | — |
| `record.reassign` | ✓ | ✓ | ✓ | — | — |
| `lead.convert` | ✓ | ✓ | ✓ | own | — |
| `pipeline.manage` | ✓ | ✓ | — | — | — |
| `report.read` | ✓ | ✓ | ✓ | own | ✓ |
| `report.export` / `record.export` | ✓ | ✓ | ✓ | — | — |
| `import.run` | ✓ | ✓ | ✓ | — | — |
| `member.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `member.invite` / `member.update` / `member.remove` | ✓ | ✓ (≤ manager) | — | — | — |
| `member.forceSignOut` | ✓ | ✓ | — | — | — |
| `settings.manage` | ✓ | ✓ | — | — | — |
| `branding.manage` | ✓ | ✓ | — | — | — |
| `audit.read` | ✓ | ✓ | — | — | — |
| `privacy.manage` (DSAR export/erase) | ✓ | ✓ | — | — | — |
| `tenant.export` / `tenant.delete` / `tenant.transferOwnership` | ✓ | — | — | — | — |
| `plan.read` / `billing.read` | ✓ | ✓ | — | — | — |
| `billing.manage` (subscribe, change plan, cancel) | ✓ | — | — | — | — |
| `branding.manage` requires agency setting `allowWorkspaceBranding` | | | | | |

Platform permissions (`platform.agency.*`, `platform.tenant.*`, `platform.plan.*`, `platform.domain.*`, `platform.gateway.*`) belong only to `platformAdmins`; agency permissions are in [§24](#24-agencies--resellers-agy). Both are evaluated separately on the console hosts.

---

## 5. Common Record Behavior (REC)

### FR-REC-001 · P1 · Soft delete, trash, restore, purge
**AC**
1. Delete moves records to Trash (`isDeleted=true`, `deletedAt`, `deletedBy`); hidden from lists, search, reports, dashboards.
2. Restore within 30 days returns the record with relationships intact.
3. A scheduled job hard-deletes records whose `deletedAt` > 30 days, including dependent activities owned exclusively by them.
4. Deleting a company does not delete contacts; it unlinks them (contacts' `companyId` set null on purge, displayed as "(deleted company)" while in trash).

### FR-REC-002 · P2 · Tags
**AC**
1. Up to 20 tags per record; tag names 1–32 chars, normalized case-insensitively; tenant tag catalog (max 500).
2. Lists filter by a single tag (Firestore `array-contains` constraint) combined with allowlisted filters.

### FR-REC-003 · P3 · Custom fields — post-MVP.

---

## 6. Companies (COM)

### FR-COM-001 · P0 · Company CRUD
Fields: name*, domain, industry (enum), size band (enum), phone, website, address (line1, line2, city, region, postalCode, country ISO-3166-1 alpha-2), description, ownerUid*, tags.

**AC**
1. Create/edit validates per [§23](#23-field-validation-reference); invalid input shows inline errors; server re-validates.
2. List shows name, domain, owner, contacts count, open deals count, updated date.
3. Mutations audited and appear as system activities.

### FR-COM-002 · P1 · Company detail aggregation
**AC** Company page shows: summary, contacts (paginated), deals (open/closed), tasks, activity timeline — each section loads independently with skeletons; any section failing shows an inline error without breaking the page.

### FR-COM-003 · P2 · Duplicate domain warning
**AC** When creating/editing with a normalized domain (`lowercase`, strip `www.`, strip protocol/path) already used by a non-deleted company in the same tenant, user sees a warning with link (Members: existence-only message per FR-RBAC-004 AC4); may proceed (Manager+) or cancel. Never checks other tenants.

---

## 7. Contacts & Customers (CON)

**[PROPOSED] Definition:** a *customer* is a contact (and optionally its company) whose `lifecycleStage = customer`. There is no separate "customers" collection — this avoids duplicate data and sync problems.

### FR-CON-001 · P0 · Contact CRUD
Fields: firstName*, lastName, email (unique warning), phone(s) (max 3, E.164 preferred), jobTitle, companyId, lifecycleStage, leadSource, address, ownerUid*, tags, doNotContact (bool), notes summary.

**AC** Same validation, listing, and audit behavior as FR-COM-001. Contact list columns: name, email, company, stage, owner, last activity.

### FR-CON-002 · P1 · Company association
**AC** A contact links to ≤ 1 primary company; company detail lists linked contacts; changing company is recorded as a system activity.

### FR-CON-003 · P1 · Duplicate email warning
**AC** Normalized email (`trim`, lowercase) match against non-deleted contacts in the same tenant shows a warning before save; import uses the same rule with configurable action (skip/update/create).

### FR-CON-004 · P1 · Lifecycle stage (customer management)
Stages: `subscriber`, `lead`, `opportunity`, `customer`, `churned`, `other`.

**AC**
1. Stage changes are recorded as system activities with old/new values.
2. Marking a deal **won** prompts (configurable auto) to set the primary contact's stage to `customer`.
3. "Customers" navigation item = contact list pre-filtered to `customer`.

---

## 8. Leads (LEAD)

### FR-LEAD-001 · P0 · Lead CRUD
Fields: firstName*, lastName, email, phone, companyName, jobTitle, source (enum: website, referral, event, outbound, import, other), status (`new`, `contacted`, `qualified`, `unqualified`, `converted`), ownerUid*, notes, tags, estimatedValue (minor units).

**AC** Validation/list/audit as standard; status `converted` cannot be set manually.

### FR-LEAD-002 · P0 · Lead conversion
**AC**
1. Conversion dialog: create or match contact (by email), create or match company (by name/domain), optionally create deal (pipeline stage = first open stage).
2. All writes occur in **one Firestore transaction**; on failure nothing is written.
3. Lead becomes `converted` with `convertedTo {contactId, companyId?, dealId?}`; converted leads are read-only.
4. Activities on the lead are linked to the new contact (relatedKeys updated) — via background job if > 400 activities (transaction limits), with idempotency.
5. Double conversion (concurrent) is prevented (transaction reads lead status).

### FR-LEAD-003 · P1 · Lead assignment
**AC** Manager+ can assign/reassign owner; assignee receives in-app notification (FR-NOTF-001). Round-robin rules are P3.

### FR-LEAD-004 · P3 · Web-to-lead forms — post-MVP.

---

## 9. Deals & Pipeline (DEAL)

### FR-DEAL-001 · P0 · Deal CRUD
Fields: name*, amount (integer minor units ≥ 0, ≤ 10^13), currency (tenant default, A-05), pipelineId*, stageId*, expectedCloseDate, probability (0–100, defaults from stage), primaryContactId, companyId, ownerUid*, status (`open`, `won`, `lost`), lostReason, closedAt, tags.

**AC** Amounts displayed with tenant locale/currency; no floating-point arithmetic on money.

### FR-DEAL-002 · P1 · Configurable pipeline (single pipeline in MVP)
**AC**
1. Owner/Admin can add, rename, reorder, and remove stages (2–15 open stages + fixed Won and Lost).
2. Removing a stage that contains deals requires selecting a target stage; deals are moved by a batched job before stage removal.
3. Each stage has default probability.

### FR-DEAL-003 · P1 · Kanban board with accessible alternative
**AC**
1. Board columns per stage show count and summed amount (per currency).
2. Drag-and-drop moves deals; an equivalent **non-drag** control ("Move to stage…" menu, keyboard operable) exists on every card (WCAG 2.5.7).
3. Optimistic update rolls back with an error toast if the server rejects.
4. On mobile, columns scroll horizontally with snap; a list view toggle exists.

### FR-DEAL-004 · P1 · Win/loss and stage history
**AC**
1. Marking lost requires `lostReason` (enum + optional text ≤ 500).
2. Each stage change writes a system activity `deal.stage_changed` with from/to, actor, timestamp; `stageEnteredAt` updated.
3. Reopening a closed deal is Manager+ and audited.

### FR-DEAL-005 · P3 · Multiple pipelines — post-MVP.

---

## 10. Tasks (TASK)

### FR-TASK-001 · P0 · Task CRUD
Fields: title*, description, dueAt (date or datetime, stored UTC with tenant/user TZ display), priority (`low`,`normal`,`high`), status (`open`,`done`), assigneeUid*, related record (contact/company/lead/deal, optional), completedAt.

**AC** Assignee or Manager+ can complete; completing writes a system activity on the related record.

### FR-TASK-002 · P1 · "My tasks" view
**AC** Groups: Overdue, Today, Next 7 days, Later, No date — computed in the user's timezone; counts shown in navigation badge.

### FR-TASK-003 · P2 · Due reminders
**AC** At the due time (or 09:00 user-local for date-only tasks), the assignee receives an in-app notification and, if enabled, an email; reminder sent once (idempotent key `taskId+dueAt`).

### FR-TASK-004 · P3 · Recurring tasks — post-MVP.

---

## 11. Activities & Communication (ACT)

### FR-ACT-001 · P0 · Activity logging and timeline
Types: `call`, `meeting`, `email` (logged manually), `note`. Fields: type*, subject*, body (plain text/limited Markdown ≤ 10,000 chars, rendered sanitized), occurredAt*, durationMinutes, outcome, related records (1–4).

**AC**
1. Timeline on each record shows its activities newest-first with cursor pagination.
2. Body rendering never executes HTML/script (TC-SEC-010).
3. Contact "mailto:" and "tel:" links available for communication (actual sending from CRM is P3).

### FR-ACT-002 · P1 · System activities
**AC** System events (created, stage change, conversion, owner change, lifecycle change, task completed) appear in timelines, visually distinct, non-editable.

### FR-ACT-003 · P3 · Send email from CRM (tracked) — post-MVP.
### FR-ACT-004 · P3 · Gmail/Outlook email & calendar sync — post-MVP.

---

## 12. Dashboard (DASH)

### FR-DASH-001 · P1 · KPI dashboard
Widgets: open pipeline value by stage; deals won (count/value) this month vs last; new leads this month; lead→customer conversion rate (90 days); my tasks due today/overdue; recent activities (10).

**AC**
1. Numbers match report calculations on the same fixtures (TC-DASH-001).
2. Each widget loads independently; failure isolates to the widget.
3. Uses Firestore aggregation queries (`count`, `sum`) — no full collection scans.
4. Initial dashboard server render p95 ≤ 1.2 s at A-06 scale.

### FR-DASH-002 · P2 · Role-scoped view
**AC** Members see only their own data (no team toggle, per FR-RBAC-004); Managers+ and Viewers see workspace-wide data with an owner filter.

---

## 13. Search, Filtering, Sorting (SRCH)

### FR-SRCH-001 · P1 · Global search (prefix)
**AC**
1. Search box (⌘/Ctrl+K) queries contacts, companies, leads, deals by **word prefix** of name, email, company domain (min 2 chars).
2. Results grouped by entity, max 5 each with "see all".
3. Only current tenant, non-deleted records, and for Members only their own records. Debounced 250 ms; rate-limited.
4. Help text explains prefix matching (R-03).

### FR-SRCH-002 · P0 · Lists: filter, sort, paginate
**AC**
1. Filters allowlisted per entity ([03 §8](03-database-schema.md#8-query-patterns-and-indexes)); unsupported combinations are not offered.
2. Sort options allowlisted; sort field never taken raw from user input.
3. Cursor pagination: navigating forward/back yields no duplicates or gaps under concurrent inserts (TC-SRCH-002).
4. Filter/sort state is reflected in the URL (shareable within tenant).
5. Empty state distinguishes "no records yet" from "no results for filters".

### FR-SRCH-003 · P3 · Saved views — post-MVP.
### FR-SRCH-004 · P3 · Full-text search engine — post-MVP (ADR-010).

---

## 14. Reporting (RPT)

### FR-RPT-001 · P1 · Standard reports
1. Pipeline by stage (count, value). 2. Won vs lost by month (12 months). 3. Lead source → conversion rate. 4. Activities by user by type (date range ≤ 12 months).

**AC** Date ranges evaluated in tenant timezone; charts have accessible data-table equivalents; correct against fixtures (TC-RPT-001).

### FR-RPT-002 · P2 · Report export
**AC** Manager+ can export a report's data table as CSV; CSV cells beginning with `= + - @ \t \r` are prefixed with `'` (formula-injection protection).

### FR-RPT-003 · P3 · Custom report builder — post-MVP.

---

## 15. Notifications (NOTF)

### FR-NOTF-001 · P1 · In-app notifications
Events: record assigned to you, task due, invitation accepted (to inviter), import/export finished, role changed.

**AC**
1. Bell icon with unread count; list with mark-read/mark-all-read; retained 90 days.
2. Updates via polling (≤ 60 s) and on navigation in MVP (ADR-003).
3. A user can only read their own notifications in the current tenant (TC-NOTF-001).

### FR-NOTF-002 · P2 · Email notifications and preferences
**AC** Per-user, per-tenant toggles per event type; emails branded (FR-BRAND-003); include unsubscribe-from-type link (signed token); no CRM record content beyond title in email body.

### FR-NOTF-003 · P3 · Web push — post-MVP.

---

## 16. Import / Export (IMP)

### FR-IMP-001 · P1 · CSV import
**AC**
1. Entities: contacts, companies, leads. File ≤ 10 MB, ≤ 10,000 rows, UTF-8 (BOM tolerated), comma or semicolon.
2. Steps: upload → column mapping (auto-suggest) → validation preview (first 50 rows + error count) → duplicate handling choice → run as background job.
3. Progress visible; completion notification; downloadable error report CSV (row number + reason).
4. Partial success allowed; job is resumable/idempotent per chunk (500 rows).
5. Usage limits enforced before run (FR-PLAN-001).

### FR-IMP-002 · P1 · CSV export of lists
**AC** Manager+ exports current filtered list (≤ 50,000 rows) as background job; formula-injection protection; audited with filter description; signed download URL 24 h.

### FR-IMP-003 · P3 · Importers from other CRMs — post-MVP.

---

## 17. Branding (BRAND)

### FR-BRAND-001 · P0 · Logo, favicon, app name
**AC**
0. Branding is resolved platform defaults → agency branding → workspace override; workspace Owners/Admins can edit only if the agency enables `allowWorkspaceBranding` (FR-AGY-004). Agency staff can always edit their workspaces' branding.
1. Owner/Admin (or agency staff) uploads logo (light and optional dark) PNG/JPEG/WebP ≤ 1 MB, ≤ 2048×2048; favicon PNG ≤ 256 KB; SVG not accepted in MVP.
2. Files are re-encoded server-side, metadata stripped, stored with content-hash names.
3. App name (1–40 chars) replaces the platform name in titles, emails, login page.
4. Branding changes visible to all members within 60 s.

### FR-BRAND-002 · P1 · Brand colors with contrast safety
**AC**
1. Primary and accent colors (hex). System derives foreground colors meeting ≥ 4.5:1 text contrast and ≥ 3:1 UI component contrast.
2. If a color cannot produce compliant combinations, save is blocked with an explanation and a suggested adjusted color.
3. Live preview of buttons, links, sidebar in light/dark mode.

### FR-BRAND-003 · P1 · Branded transactional emails
Templates: invitation, verify email, password reset, notification digest/event, export ready.

**AC**
1. Tenant logo, name, primary color applied; tenant can edit subject line and an intro paragraph (plain text ≤ 500 chars) with allowlisted variables only (`{{tenant.name}}`, `{{user.firstName}}`, `{{inviter.name}}`).
2. All variables HTML-escaped; tenant cannot inject HTML/links (anti-phishing, R-13).
3. Sent from operator domain with tenant display name (e.g., `"Acme CRM" <no-reply@mail.example.com>`); `Reply-To` optional verified address (P2).
4. Preview + test-send to self (rate-limited 10/day).

### FR-BRAND-004 · P2 · "Powered by" badge per plan
**AC** Badge shown unless plan entitlement `whiteLabel.removePoweredBy = true`.

### FR-BRAND-005 · P2 · Agency sender domain (SPF/DKIM)
**AC** An agency can verify a sending domain (e.g., `mail.agency-one.example`) with the email provider (DKIM/SPF/return-path records shown in the agency console); once verified, its workspaces' emails are sent from it; until then the operator domain is used with the agency display name.

---

## 18. Settings (SET)

### FR-SET-001 · P1 · Tenant settings
Timezone (IANA), locale (BCP 47), default currency (ISO 4217), date format, week start, fiscal year start month.

**AC** Changes apply to dashboards/reports immediately; audited; validation against IANA/ISO lists.

### FR-SET-002 · P1 · User profile and preferences
Display name, avatar (same upload rules as logos, ≤ 512 KB), timezone override, notification preferences (FR-NOTF-002), theme (system/light/dark).

---

## 19. Plans, Limits & Entitlements (PLAN)

### FR-PLAN-001 · P1 · Plan entitlements enforced server-side
Operator defines plan templates (entitlements); agencies set the price per plan in their gateway currency (OQ-25). Example plans (placeholders; owner to confirm):

| Entitlement | Trial (14 d) | Starter | Growth | Enterprise |
|-------------|------|---------|--------|-----------|
| `limits.seats` | 3 | 5 | 25 | custom |
| `limits.records` (contacts+companies+leads+deals) | 1,000 | 10,000 | 100,000 | custom |
| `limits.importRowsPerJob` | 1,000 | 10,000 | 10,000 | custom |
| `features.reports` | ✓ | ✓ | ✓ | ✓ |
| `features.import` | ✓ | ✓ | ✓ | ✓ |
| `whiteLabel.removePoweredBy` | — | — | ✓ | ✓ |
| `features.auditExport` | — | — | ✓ | ✓ |

**AC** Exceeding a limit returns `403 PLAN_LIMIT_EXCEEDED` with upgrade guidance; enforced in the same transaction as the create where feasible; expired trial → read-only mode (no data loss).

### FR-PLAN-002 · P2 · Usage counters and warnings
**AC** Usage page shows seats/records vs limits; banners at 80% and 100%; counters reconciled nightly by a job (drift correction).

### FR-PLAN-003 · Retired (2026-10-09) — superseded by FR-BILL-001..005 (billing is in MVP).

### FR-PLAN-004 · P1 · Feature flags with inheritance
**AC** Effective config = platform defaults → plan entitlements → tenant overrides (platform-admin only) — see [05 §8](05-white-label-and-multi-tenancy.md#8-feature-flags-plan-limits-and-configuration-inheritance). Flags evaluated server-side; client receives only the resolved booleans it needs.

---

## 20. Audit Log (AUD)

### FR-AUD-001 · P0 · Audit events
Events (minimum): auth session created/revoked (per tenant), member invited/joined/role changed/removed, ownership transferred, settings/branding changed, record create/update/delete/restore/purge/reassign, lead converted, import/export started/completed, DSAR export/erasure, tenant suspended/reactivated/deletion requested/cancelled, plan changed, forced sign-out.

**AC** Each entry: actor (uid, email snapshot, type), action, target (type, id), changed field **names** (values only for non-PII enums/status), `requestId`, IP, user-agent, timestamp. Written in the same transaction/batch as the change where possible; otherwise via transactional outbox.

### FR-AUD-002 · P2 · Audit viewer
**AC** Owner/Admin can filter by action, actor, date range (allowlisted combos); paginated; CSV export if `features.auditExport`.

### FR-AUD-003 · P0 · Immutability and retention
**AC** No application code path updates or deletes audit entries except the retention TTL (365 days default) and tenant purge; client rules deny all; tests attempt modification (TC-AUD-003).

---

## 21. Privacy (PRIV)

### FR-PRIV-001 · P1 · Data subject export (contact)
**AC** Admin+ exports all data related to a contact (contact record, activities, tasks, deals referencing it, lead origin) as JSON + CSV; audited.

### FR-PRIV-002 · P1 · Data subject erasure (contact)
**AC** Admin+ with re-auth erases a contact: hard-deletes contact and its activities; redacts contact references on deals/tasks (`"[erased]"`); writes erasure log entry (contactId hash only) used to re-apply erasure after any backup restore (R-09); bypasses 30-day trash.

### FR-PRIV-003 · P1 · User account deletion
**AC** User can delete their account from profile; blocked while sole Owner of any tenant (must transfer or delete tenant); memberships removed; records they own remain with `ownerUid` reassigned to tenant Owner; Auth user deleted.

---

## 22. Public Site (PUB)

### FR-PUB-001 · P1 · Marketing site
Operator site (for prospective agencies). Pages: Home, Features, For Agencies (white-label program), Pricing/Partner plans, Security, About, Contact / Request a demo, Login entry (workspace finder), Privacy Policy, Terms, Cookie Policy. No sign-up page.

**AC** Meets NFR-SEO-002, NFR-PERF-001, NFR-A11Y-001; content guidelines in [07](07-seo-aeo-and-performance.md). Demo requests are stored and send a confirmation email only to the address supplied in the form; honeypot submissions are not stored or emailed. Workspace finder sends an email listing the user's workspaces (no on-screen enumeration).

### FR-PUB-002 · P2 · Docs/help center and FAQ
**AC** Statically generated docs with search (client-side index of public content), FAQ with `FAQPage` structured data, "last updated" dates.

### FR-PUB-003 · P1 · Tenant-branded login page
**AC** On every workspace host `/login` (custom domain, agency subdomain, or platform subdomain): tenant logo/name/colors; `X-Robots-Tag: noindex, nofollow`; no member names or counts; no OG data exposing anything beyond tenant display name (configurable off).

---

## 23. Field Validation Reference

Shared Zod schemas live in `src/shared/schemas/*` (proposed) and are used by forms and server. Server is authoritative.

| Field type | Rule |
|-----------|------|
| Short text (names, titles) | trim; 1–120 chars; reject control chars except none; Unicode NFC normalize |
| Long text (descriptions, bodies) | ≤ 10,000 chars (activities), ≤ 2,000 (descriptions) |
| Email | trim, lowercase for `emailNormalized`; RFC 5322 practical regex; ≤ 254 chars |
| Phone | ≤ 32 chars; digits, spaces, `+ - ( )`; store `phoneE164` when parseable (libphonenumber) |
| URL / domain | `https:` or `http:` only; ≤ 2,048 chars; domain normalized; never fetched server-side (SSRF) |
| Money | integer minor units, 0 ≤ x ≤ 10^13; currency ISO 4217 from allowlist |
| Dates | ISO 8601; stored as Firestore Timestamp (UTC) |
| Enums | strict allowlist; unknown → 400 |
| IDs in input | `^[A-Za-z0-9_-]{1,64}$`; existence + tenant ownership verified server-side |
| Tags | 1–32 chars, `^[\p{L}\p{N} _-]+$`u, ≤ 20 per record |
| Color | `^#[0-9a-fA-F]{6}$` |
| Unknown properties | stripped (`.strict()` on server for mutation payloads → 400) |

---

## 24. Agencies / Resellers (AGY)

**[CONFIRMED]** Agencies resell the CRM to their own clients. Hierarchy: instance → agency → workspace ([05 §1](05-white-label-and-multi-tenancy.md#1-tenancy-model)).

### FR-AGY-001 · P0 · Agency provisioning and lifecycle
**AC**
1. Platform Super Admin creates an agency: name, slug, status, owner email, quotas (`maxWorkspaces`, `maxSeatsTotal`), entitlements (`canProvisionWorkspaces`, `allowWorkspaceBranding` default), billing mode (gateway or manual), optional base domain.
2. Agency Owner receives an invitation to the agency console (`partners.example.com`); acceptance creates the account (FR-AUTH-001).
3. Agency status `active | suspended | pending_deletion`; suspension cascades to all its workspaces within ≤ 60 s; deletion requires all workspaces deleted or transferred first.
4. All agency lifecycle actions audited (platform audit log).

### FR-AGY-002 · P0 · Agency staff roles
Roles: `agency_owner`, `agency_admin`.

| Agency permission | agency_owner | agency_admin |
|-------------------|:---:|:---:|
| `agency.workspace.read` (metadata: name, status, plan, seats, usage, billing status) | ✓ | ✓ |
| `agency.workspace.create` (only if entitlement `canProvisionWorkspaces`) | ✓ | ✓ |
| `agency.workspace.suspend` / `reactivate` | ✓ | ✓ |
| `agency.workspace.branding` / `agency.workspace.domain` | ✓ | ✓ |
| `agency.workspace.inviteOwner` (re-send / replace owner invite) | ✓ | ✓ |
| `agency.branding.manage` (agency defaults, sender domain) | ✓ | ✓ |
| `agency.billing.manage` (gateway credentials, prices) | ✓ | — |
| `agency.staff.manage` | ✓ | — |
| Read workspace CRM records | — | — |

**AC** Agency staff never gain CRM data access through agency roles; to view a client's CRM they must be invited into that workspace as a member (OQ-21), which is visible to the workspace's owner in its member list and audited.

### FR-AGY-003 · P0 · Agency isolation
**AC** Agency staff can list and act on only their own agency and its workspaces; any attempt to reference another agency's workspace, domain, staff, plan price, or billing record returns 404 (TC-AGY-003). Workspace users never see agency-internal data (other clients, quotas, prices other than their own plan).

### FR-AGY-004 · P1 · Branding inheritance
**AC** Effective branding = platform default → agency branding → workspace override (only if `allowWorkspaceBranding`). Changing agency branding updates all non-overridden workspaces within ≤ 60 s. Contrast rules of FR-BRAND-002 apply at every level.

### FR-AGY-005 · P1 · Agency console
**AC** Agency console lists the agency's workspaces with status, plan, seats used/limit, record usage, subscription status, domains and their DNS status; supports search/filter by status; provides actions per FR-AGY-002; responsive and accessible like the main app.

### FR-AGY-006 · P2 · Agency usage reporting
**AC** Aggregate per-workspace metrics only (seats, record counts, active users last 30 d, subscription status, revenue from subscriptions in gateway currency); never CRM content; CSV export.

---

## 25. Billing & Payments (BILL)

**[CONFIRMED]** Gateways differ per client; Razorpay primary, PayPal and Stripe supported. **[ASSUMPTION A-13]** Each agency collects from its own client workspaces using the agency's gateway account.

### FR-BILL-001 · P1 · Payment gateway abstraction with per-agency configuration
**AC**
1. A `PaymentGateway` interface (create customer, create subscription/checkout session, cancel, change plan, fetch subscription, fetch invoices/payments, verify webhook) with adapters: **Razorpay (P1)**, **PayPal (P2)**, **Stripe (P2)**.
2. Agency Owner (or platform staff) selects the gateway and enters credentials once in the agency console; credentials stored only in Secret Manager (NFR-SEC-007), shown masked afterwards, test/live mode flag.
3. Agency maps each plan template to the gateway's plan/price ID and currency; validation fetches the plan from the gateway to confirm amount/currency/interval.
4. "Manual billing" mode (FR-BILL-005) available when no gateway configured.

### FR-BILL-002 · P1 · Workspace subscription lifecycle
**AC**
1. Workspace Owner (`billing.manage`) chooses a plan and is redirected to the gateway's **hosted** checkout/subscription approval page; no payment data is entered in our UI.
2. Entitlements change **only** after a verified webhook (or server-side fetch from the gateway API) confirms the subscription state — never on client redirect alone.
3. States: `trialing`, `active`, `past_due` (grace 7 days, banner to owners), `suspended_for_nonpayment` (read-only), `cancelled` (read-only at period end). State changes audited and notified to workspace owner and agency.
4. Plan change and cancellation from the billing page (via gateway API), effective per gateway semantics (immediate or at period end, shown before confirm).

### FR-BILL-003 · P0 · Webhook security and reconciliation
**AC**
1. Endpoint per gateway and agency: `/api/webhooks/{provider}/{agencyId}`; signature verified against that agency's webhook secret using the provider's documented scheme (Razorpay HMAC-SHA256 `X-Razorpay-Signature` over raw body; Stripe `Stripe-Signature`; PayPal verify-webhook-signature API — verify each in T-06-11).
2. Invalid signature → 400, logged as security event, no state change.
3. Idempotent: provider event ID stored in `paymentEvents`; duplicates acknowledged without reprocessing; out-of-order events resolved by fetching current subscription state from the gateway API.
4. Amount, currency, plan, and workspace mapping are taken from our records + gateway API, never trusted from the payload's notes/metadata alone.
5. Nightly reconciliation job compares local subscription state with the gateway and alerts on drift.

### FR-BILL-004 · P1 · Billing page and payment history
**AC** Workspace Owner/Admin sees current plan, status, next billing date, and payment/invoice history (date, amount, currency, status, gateway receipt link) from stored webhook summaries; agency sees the same per workspace in the agency console. No card/bank details stored or displayed beyond what the gateway returns as masked info (e.g., brand + last 4), if any.

### FR-BILL-005 · P2 · Manual billing mode
**AC** Agencies without a gateway (or for offline deals) set a workspace's plan and paid-until date manually in the agency console; expiry triggers the same past_due/read-only flow as FR-BILL-002; all changes audited.
