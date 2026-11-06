# Screen-reader checklist (TC-A11Y-003, manual)

Automated checks (axe on every route in light and dark, keyboard-only journey) are green. Screen
readers still need a human pass before release. Record results per row: ✓ / ✗ + note.

**Matrix:** NVDA + Chrome (Windows) · VoiceOver + Safari (macOS) · VoiceOver + Safari (iOS) ·
TalkBack + Chrome (Android).

| # | Journey / check | Expect | NVDA | VO mac | VO iOS | TalkBack |
|---|-----------------|--------|------|--------|--------|----------|
| 1 | Sign in on a workspace host | Logo/app name announced; field labels; errors read via alert | | | | |
| 2 | Landmarks | header, "Main navigation", main; skip link first | | | | |
| 3 | Navigation drawer (phone) | "Open navigation" button; dialog announced; current page = "current page" | | | | |
| 4 | Create contact with an error | Field error announced and linked to the field (aria-describedby) | | | | |
| 5 | Lead → Convert dialog | Dialog title/description read; focus returns to "Convert lead" on close | | | | |
| 6 | Pipeline board | Columns as regions with stage name + count/sum; "Move {deal} to stage" select; success toast read | | | | |
| 7 | My tasks | Group headings; checkbox "Mark {title} done"; "Task completed" + Undo announced | | | | |
| 8 | Activity timeline | Items in order; Markdown body readable; system events distinct | | | | |
| 9 | Search (Ctrl+K) | Dialog; result count status; results grouped by entity | | | | |
| 10 | Notifications | Bell announces unread count; panel list; "Mark … as read" buttons | | | | |
| 11 | Reports | Tables with headers; bars hidden from AT | | | | |
| 12 | Import wizard | Steps, mapping selects "Field for column …", error rows readable | | | | |
| 13 | Branding page | Contrast error announced; uploads report errors | | | | |
| 14 | Offline / session expired | Offline banner (alert); session-expired dialog | | | | |
| 15 | Agency console workspace detail | Domain records table; status messages after Check/Make main | | | | |
