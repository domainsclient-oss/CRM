# 06 — UI/UX and Responsive Design

> **Prev:** [05 White-Label](05-white-label-and-multi-tenancy.md) · **Next:** [07 SEO/AEO/Performance](07-seo-aeo-and-performance.md)
> Target: **WCAG 2.2 Level AA** (NFR-A11Y-001). Components live in `packages/ui` (ADR-011). Visual design direction is a proposal; final look requires owner sign-off in Phase 0.

## Contents

1. [Design principles](#1-design-principles)
2. [Design tokens](#2-design-tokens)
3. [Typography](#3-typography)
4. [Component inventory](#4-component-inventory)
5. [Layouts and navigation](#5-layouts-and-navigation)
6. [Key screens](#6-key-screens)
7. [Responsive behavior](#7-responsive-behavior)
8. [Accessibility requirements](#8-accessibility-requirements)
9. [States: loading, empty, error, success, offline](#9-states-loading-empty-error-success-offline)
10. [Consistency and visual regression](#10-consistency-and-visual-regression)

---

## 1. Design principles

1. **Clarity over decoration** — dense data, calm neutrals, tenant brand color used for primary actions and accents only.
2. **Brand-safe theming** — tenants change brand tokens; contrast is guaranteed by derivation ([05 §4.1](05-white-label-and-multi-tenancy.md#41-theme-derivation-fr-brand-002)).
3. **Keyboard first** — every action reachable without a mouse; command palette (⌘/Ctrl+K).
4. **Mobile-complete** — all MVP flows completable on a 360 px phone.
5. **Progressive disclosure** — common fields first, "more fields" collapsed.
6. **Predictable feedback** — every action yields visible, announced feedback.

## 2. Design tokens

CSS custom properties on `:root` and `[data-theme="dark"]`; Tailwind theme maps to these variables.

| Group | Tokens (examples) |
|-------|-------------------|
| Brand (tenant) | `--brand-primary`, `--brand-primary-fg`, `--brand-primary-on-surface`, `--brand-accent`, `--brand-accent-fg`, `--focus-ring` |
| Neutral surfaces | `--surface-0` (page), `--surface-1` (card), `--surface-2` (raised), `--border`, `--border-strong` |
| Text | `--text-primary` (≥ 7:1 on surface-0), `--text-secondary` (≥ 4.5:1), `--text-disabled` (exempt, but ≥ 3:1 preferred) |
| Semantic | `--success`, `--warning`, `--danger`, `--info` + `-fg` and `-subtle` variants, all contrast-checked in both themes |
| Spacing | 4 px base: `0, 1(4), 2(8), 3(12), 4(16), 5(20), 6(24), 8(32), 10(40), 12(48), 16(64)` |
| Radius | `sm 4px`, `md 8px`, `lg 12px`, `full` |
| Elevation | `shadow-1` (cards), `shadow-2` (popovers), `shadow-3` (dialogs) — subtle; borders carry structure |
| Z-index | `dropdown 1000, sticky 1100, drawer 1200, dialog 1300, toast 1400` |
| Motion | `duration-fast 120ms`, `duration-base 200ms`; `prefers-reduced-motion` → no non-essential motion |
| Breakpoints | `sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536` |

Platform default brand (before tenant customization): primary `#2563EB` (verify contrast with derivation), accent `#0EA5E9` — placeholder until OQ-16.

## 3. Typography

- Font: system UI stack by default (zero font download); optional `next/font` self-hosted Inter variable for marketing site (subset, `display: swap`).
- Scale (rem, 16 px base): `xs .75`, `sm .875`, `base 1`, `lg 1.125`, `xl 1.25`, `2xl 1.5`, `3xl 1.875`, `4xl 2.25` (marketing only).
- Line height 1.5 body, 1.25 headings; max line length ~75ch for prose.
- Text must remain usable at 200% zoom and with WCAG 1.4.12 text-spacing overrides.
- Numbers in tables: `font-variant-numeric: tabular-nums`.

## 4. Component inventory

All built on accessible primitives (Radix UI) with tokens; each has unit/component tests (RTL + axe) and Storybook-style stories or a `/ui-catalog` dev route for visual regression (decide in T-01-08).

| Category | Components |
|----------|-----------|
| Actions | Button (primary/secondary/ghost/destructive; loading state), IconButton (requires `aria-label`), Link, Menu/DropdownMenu, SplitButton |
| Inputs | TextField, TextArea, Select, Combobox (async, for owner/company pickers), Checkbox, RadioGroup, Switch, DatePicker (with typed-input fallback), CurrencyInput (minor units), PhoneInput, TagInput, FileDrop (with button alternative), ColorInput (hex + preview + contrast badge) |
| Forms | Form, FormField (label + description + error, wiring `aria-describedby`/`aria-invalid`), ErrorSummary (focus on submit failure), FieldSet |
| Data display | DataTable (sortable headers with `aria-sort`, row actions, selection, responsive card mode), DescriptionList, Badge/StatusPill, Avatar, Timeline, KPI Card, Chart wrapper (with data-table alternative), Pagination (cursor: Prev/Next + page size) |
| Overlays | Dialog, AlertDialog (destructive confirm), Drawer/Sheet, Popover, Tooltip (non-essential info only), CommandPalette |
| Feedback | Toast (aria-live polite; errors assertive), InlineAlert, Banner (plan/suspension/offline), Skeleton, Spinner (with sr text), ProgressBar (jobs), EmptyState |
| Navigation | AppShell, Sidebar (collapsible), TopBar, Breadcrumbs, Tabs, WorkspaceSwitcher, UserMenu, NotificationBell, SkipLink |
| Domain | KanbanBoard/Column/Card (with "Move to stage" menu), RecordHeader, RelatedList, ActivityComposer, ImportWizard steps, BrandingPreview |

## 5. Layouts and navigation

### 5.1 App shell
- **Desktop (≥ lg):** left sidebar (240 px; collapsible to 64 px icons with tooltips + accessible names), top bar (search trigger, quick-create "+", notifications, user/workspace menu), main content with max width 1440 px for forms/detail, full width for tables/board.
- **Tablet (md–lg):** sidebar collapsed by default (icons), expandable as overlay.
- **Mobile (< md):** top bar with menu button → navigation drawer (focus-trapped); bottom-right floating "+ New" button with label; search icon opens full-screen search.
- Primary nav: Dashboard, Leads, Contacts, Customers (filtered contacts), Companies, Deals, Tasks, Reports; secondary: Settings, Trash, Help.
- Members see the same navigation, but every list, total, and chart reflects only their own records; list headers state "Showing your records" so empty or smaller totals are not mistaken for missing data (FR-RBAC-004).
- Billing read-only state shows a persistent banner with a "Renew subscription" action for owners and a "Contact your workspace owner" message for others.
- Skip link "Skip to main content" first focusable element; landmarks: `header`, `nav` (labelled), `main`, `aside`.

### 5.2 Page templates
| Template | Structure |
|----------|-----------|
| List | Title + count, primary action, filter bar (chips; "Filters" drawer on mobile), DataTable/cards, pagination |
| Detail | RecordHeader (name, key fields, owner, actions), Tabs or two-column (summary left; timeline + related right) → single column on mobile with sticky action bar |
| Form (create/edit) | Dialog for quick create (≤ 6 fields); full page for complete edit; sticky footer actions on mobile |
| Board | Horizontal columns; column header shows count + total |
| Settings | Left sub-nav (desktop) / select-menu (mobile); sectioned forms with per-section save |
| Auth pages | Centered card, tenant logo/app name, minimal chrome |

## 6. Key screens

| Screen | Must include |
|--------|-------------|
| Dashboard | KPI cards (4), pipeline-by-stage bar chart + table toggle, my tasks list, recent activity, empty-state onboarding checklist for new tenants |
| Contacts/Companies/Leads lists | Columns per [01](01-product-requirements.md); bulk select (delete, reassign, tag) — Manager+ only |
| Contact detail | Header, contact info, company link, lifecycle stage control, deals, tasks, timeline with ActivityComposer |
| Lead detail + Convert dialog | Convert stepper: contact match → company match → optional deal → review → confirm |
| Deals board | Columns, card (name, company, amount, close date, owner avatar), keyboard "Move to stage", list toggle |
| Tasks | Grouped list (Overdue/Today/…), quick complete checkbox with undo toast |
| Reports | Report picker, date range, chart + accessible table, export button |
| Settings → Branding | Upload logo/favicon, color inputs with contrast badges, live preview (light/dark), powered-by toggle |
| Settings → Members | Members table, invite dialog, pending invitations, role change, remove flow with reassignment; members invited from the agency flagged "Agency staff" |
| Settings → Billing | Current plan & status, next billing date, change plan / subscribe (redirect to gateway hosted page), cancel, payment history table, "processing payment" return page that polls status |
| Settings → Branding (gated) | Shown only if agency allows workspace branding; otherwise read-only preview with "Managed by {agency}" |
| Settings → Pipeline | Reorderable stage list (drag + move up/down buttons) |
| Import wizard | 4 steps with progress indicator; accessible error table |
| Notifications | Panel/drawer, mark read, link to record |
| Trash | Filter by type, restore, purge (Manager+) |
| **Agency console** (`partners.example.com`) | Workspaces table (status, plan, seats, usage, billing, domain status), workspace detail (branding, domains with DNS instructions & live status, owner invite, suspend), agency branding defaults, gateway settings (write-only secret fields, test/live toggle, plan price mapping with validation), staff management, usage report |
| **Platform console** (`console.example.com`) | Agencies, workspaces, plans, domains overview, gateway health, instance health, platform audit log; destructive actions behind re-auth + typed confirmation |
| Domain setup wizard | Enter host → DNS records with copy buttons → live verification status (polite live region) → activate / set canonical |
| Suspended / no-access / 404 / 500 | Plain-language explanation, next step, support reference |

## 7. Responsive behavior

| Element | Mobile (< 768) | Tablet (768–1023) | Desktop (≥ 1024) |
|---------|---------------|-------------------|------------------|
| Navigation | Drawer | Collapsed rail / overlay | Expanded sidebar |
| DataTable | Card list (primary field + 2–3 key fields), row → detail | Table with priority columns, others hidden via column menu | Full table, sticky header |
| Filters | Bottom sheet | Inline chips + drawer | Inline bar |
| Kanban | One column ~85vw with horizontal scroll-snap + stage selector; list view toggle | 2–3 visible columns | All columns, horizontal scroll if > fit |
| Detail page | Single column; tabs (Overview, Activity, Deals, Tasks) | Two columns where width allows | Two columns |
| Dialogs | Full-screen sheet | Centered dialog | Centered dialog |
| Charts | Simplified + table toggle | Full | Full |
| Touch targets | ≥ 44×44 px recommended (≥ 24×24 minimum WCAG 2.5.8) | same | ≥ 24×24 |

Rules: no horizontal page scroll at 320 px (except intentional board/table scroll regions, which are keyboard scrollable and labelled); content reflows at 400% zoom (WCAG 1.4.10); orientation unlocked; inputs use correct `type`/`inputmode`/`autocomplete`.

## 8. Accessibility requirements

### 8.1 Checklist (WCAG 2.2 AA highlights)
| Criterion | Implementation |
|-----------|---------------|
| 1.1.1 Non-text content | Alt text for logos ("{AppName} logo"); decorative icons `aria-hidden` |
| 1.3.1 Info & relationships | Semantic HTML, labelled form controls, table headers with `scope` |
| 1.4.3 / 1.4.11 Contrast | Text ≥ 4.5:1 (large 3:1); UI components & focus indicators ≥ 3:1 — enforced by token tests and brand derivation |
| 1.4.4 / 1.4.10 / 1.4.12 | Resize 200%, reflow at 320 CSS px, text spacing |
| 1.4.13 Content on hover/focus | Tooltips dismissible (Esc), hoverable, persistent |
| 2.1.1 Keyboard | All functionality; no keyboard traps (dialogs trap intentionally with Esc to exit) |
| 2.4.3 Focus order / 2.4.7 Focus visible | Logical DOM order; visible 2 px focus ring using `--focus-ring` |
| 2.4.11 Focus not obscured (min) | Sticky headers/footers use `scroll-padding`; toasts don't cover focused element |
| 2.5.7 Dragging movements | Kanban & stage reordering have button/menu alternatives |
| 2.5.8 Target size (min) | ≥ 24×24 px or sufficient spacing |
| 3.2.6 Consistent help | Help link in the same place (user menu / footer) on all pages |
| 3.3.1 / 3.3.3 Error identification & suggestion | Inline messages specific and actionable; ErrorSummary |
| 3.3.7 Redundant entry | Forms prefill known info (e.g., lead → contact conversion), wizard retains data across steps |
| 3.3.8 Accessible authentication (min) | Paste allowed, password managers supported, no cognitive tests; CAPTCHA (if any) has alternative |
| 4.1.2 Name, role, value | Radix primitives; custom widgets with correct ARIA |
| 4.1.3 Status messages | Toasts/inline status in `aria-live` regions; job progress announced at milestones |

### 8.2 Focus management rules
- Route change: focus moves to page `<h1>` (tabindex -1) and announces title.
- Dialog open: focus first meaningful field; close: return focus to trigger.
- After delete in list: focus next row (or list heading if empty).
- Form submit error: focus ErrorSummary, which links to fields.
- Kanban move via keyboard: focus follows moved card; live region announces "Moved {deal} to {stage}".

### 8.3 Screen reader support
Test matrix: NVDA + Firefox/Chrome (Windows), VoiceOver + Safari (macOS, iOS), TalkBack + Chrome (Android) for critical flows (TC-A11Y-003).

## 9. States: loading, empty, error, success, offline

| State | Pattern |
|-------|--------|
| Initial load | Route-level `loading.tsx` skeletons matching final layout (avoid CLS); `aria-busy` on region |
| Section load | Suspense boundaries per section (detail page, dashboard widgets) |
| Empty (first use) | Illustration-free, explanation + primary action + import link |
| Empty (filtered) | "No results for these filters" + clear-filters action |
| Validation error | Inline + ErrorSummary; preserve all input |
| Server error | Inline alert with retry; message + `requestId` reference; `error.tsx` boundary per route segment |
| Permission denied | Explain role requirement; no data leakage |
| Conflict (stale update) | Dialog: "This record changed since you opened it" → reload or view changes |
| Success | Toast (polite) for background actions; inline confirmation for forms; undo for complete/delete where feasible |
| Long jobs | Progress bar + notification on completion; user can navigate away |
| Offline / network failure | `navigator.onLine` + fetch failure detection → persistent banner "You're offline — changes can't be saved"; submit buttons disabled with explanation; form state preserved in memory (no offline queue in MVP); auto-retry reads on reconnect |
| Session expired | Mutation returns `UNAUTHENTICATED` → modal to sign in again preserving form state in memory where possible |

## 10. Consistency and visual regression

- Only `packages/ui` components in feature code (lint rule restricting raw `<button>` styling patterns is advisory; review enforces).
- Tokens only — no hard-coded colors (stylelint/ESLint Tailwind plugin rule for arbitrary color values).
- Visual regression with Playwright `toHaveScreenshot()` on: UI catalog page per component (light/dark, default + tenant brand fixture with extreme colors), key screens at 375/768/1280 (TC-VIS-001). Snapshots generated in CI's Linux container only; threshold `maxDiffPixelRatio: 0.01`; updates require reviewer approval.
- Design review checklist per UI PR: tokens used, states covered (loading/empty/error), keyboard path, mobile screenshot attached.
