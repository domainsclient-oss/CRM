# Phase 7 plan — Responsive UI and accessibility

Roadmap: [11 §Phase 7](../11-implementation-roadmap.md#phase-7--responsive-ui-and-accessibility). Spec: [06](../06-ui-ux-and-responsive-design.md).

| Task | Work |
|------|------|
| T-07-01 | App shell per 06 §5.1: sidebar ≥ lg, focus-trapped navigation drawer < lg (`aria-current` on the active item); lists switch to a card layout < md; dialogs become full-screen sheets on phones; board columns ≈ 85 vw with snap; no page-level horizontal overflow at 360 px (E2E on 360 / 768 / 1280) |
| T-07-02 | axe sweep of every workspace + console route (light and dark theme, WCAG 2.0–2.2 A/AA tags), zero serious/critical; fixes; manual screen-reader checklist recorded for the owner (TC-A11Y-003 is manual) |
| T-07-03 | Keyboard-only journeys: create a contact, convert a lead, move a deal with the "Move to stage" control, complete a task — no mouse; focus visible and never lost to `<body>` |
| T-07-04 | Visual baselines (light, dark, extreme brand colour) for dashboard, list, detail, board, login — per-platform snapshots |
| T-07-05 | States: route `loading.tsx` / `error.tsx` (with support reference) for the app segment, offline banner, session-expired dialog (form state kept in memory), undo toast for task completion, "Showing your records" note for Members, `prefers-reduced-motion`, user theme (system/light/dark) applied without an inline script, focus moved to the page heading on navigation |

Out of scope here: bulk selection (product decision pending), help centre link target (Phase 8 docs).
