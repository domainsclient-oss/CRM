# T-11-05 — Hypercare (first 14 days after launch)

**Daily (on-call primary, 15 min)**
- Dashboards:
  - 5xx rate and p95 latency per route class;
  - alerts fired (T-09-08);
  - Firestore reads per hour against the T-08-06 model;
  - `payment.*` and `billing.state_changed` events;
  - email delivery;
  - domain check errors.
- Triage new errors by request ID: assign a severity and open a task card.
- Check that the nightly runs succeeded: reconciliation, usage, purges, backups.

**Weekly**
- Review costs against the budget.
- Review pilot feedback.
- Accessibility and performance: RUM web vitals at p75 on public pages (G-5).

**Exit criteria (roadmap Phase 11 completion)**
- 14 days without SEV1.
- All postmortems closed.
- Release checklist fully ticked.
- Hypercare report written.

## Daily log

| Date | Incidents | Alerts | Notable errors | Cost vs model | Actions |
|---|---|---|---|---|---|
| | | | | | |
