# Phase 4 plan — Core CRM modules

Roadmap: [11 §Phase 4](../11-implementation-roadmap.md#phase-4--core-crm-modules). Touches protected paths
(`packages/core/**`, `firebase/firestore.indexes.json`) → human review (H3) before merge.

## Approach

One generic record layer, thin per-entity modules — avoids five copies of the same CRUD,
ownership, audit, and pagination logic (and five places to get isolation wrong).

| Layer | Files | Notes |
|-------|-------|-------|
| Shared (isomorphic) | `packages/shared/src/records/*` | Zod input schemas per entity (§23 rules), enums, normalizers (email, domain, tags), search tokens (03 §9.2), money (integer minor units, no floats), time zones (wall-clock ↔ UTC without libraries), limited-Markdown parser, list specs (allowlisted filters/sorts per entity) |
| Core | `packages/core/src/records/*` | Signed cursors (HMAC, `CURSOR_SIGNING_SECRET`), list repository built only from list specs on top of `scopedQuery`, generic create/update/delete/restore/purge/reassign with optimistic concurrency (`expectedUpdatedAt`), audit + system activities + usage counters in the same transaction; entity services for leads (conversion), deals (pipeline, stage moves, win/loss/reopen), tasks (complete, My tasks), activities (timeline), tags, trash, settings/profile |
| Indexes | `query-shapes.ts` → `firestore.indexes.json` | Shapes derived from the list specs (every filter × sort × {all, own} scope) plus hand-registered shapes; `pnpm indexes:gen` writes the index file; the existing coverage test keeps both in sync |
| UI | `packages/ui` + `apps/web/src/features/records/*` | DataTable/filter bar/pagination with URL state, field-config-driven forms (inline server errors), TagInput, SafeMarkdown (React elements only — no HTML strings), kanban with drag-and-drop **and** a "Move to stage" control on each card |
| Tests | unit (shared), integration (core, emulator), registry suite (auto-covers new actions), E2E journeys 3, 4, 5, 9, 11, 15 + own-scope journey | |

## Decisions (recorded as deviations in STATUS.md)

1. **One optional filter per list** (owner, stage/status, company, or tag) plus sort — keeps the
   composite-index count bounded (~70) and every offered combination indexed.
2. **Back navigation** uses a signed cursor trail in the URL (`trail`, max 20) — Firestore can't
   traverse a composite index in reverse without a second index per shape.
3. **Purge** and **stage-removal moves** run as server functions callable from a script/console
   now; scheduling waits for Cloud Functions (T-01-09). Stage moves are chunked (≤ 400 writes).
4. **Lead activity relink** runs in the conversion transaction up to 400 activities; above that a
   `jobs` doc (`leadActivityRelink`) is queued for the job runner (Phase 6).
5. **Task reminders** (FR-TASK-003, P2) need notifications (Phase 6); `reminderAt` is computed now.
6. **Avatar upload** and notification preferences arrive with Storage uploads (Phase 5) and
   notifications (Phase 6).
7. `record.purge` shares the `record.restore` grant (same row in the permission matrix).
