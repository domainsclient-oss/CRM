# T-11-06 — Incident runbooks and on-call (10 §11)

**Severity**

| Level | Covers | Response |
|---|---|---|
| **SEV1** | Data exposure or cross-tenant/cross-agency leak; payment manipulation; privileged-account compromise; full outage | Page immediately; incident commander within 15 min |
| **SEV2** | Major feature down for many tenants | Page during business hours; fix or roll back within 4 h |
| **SEV3** | Limited impact | Ticket |

Every SEV1/SEV2 gets a blameless postmortem within 5 working days, and its action items are tracked in task cards.

**Common first steps**
1. Open an incident channel and name an incident commander (IC).
2. Record a timeline as you go.
3. Use the **request ID** from user reports to find the log line (`jsonPayload.requestId`).
4. Prefer **rollback** (`vercel rollback`, previous functions tag) over fixing forward while the impact continues.

## R1 · Suspected cross-tenant / cross-agency data exposure (SEV1)

1. **Contain**
   - If a release caused it, roll back immediately.
   - If one workspace or agency is the source, suspend it from the platform console (takes effect within 60 s).
2. **Scope**
   - Search `tenant_mismatch` and `authz.denied` around the time.
   - Check the audit logs of the affected tenants, and the platform audit log.
   - The isolation suites (`pnpm test:integration`, registry) run against the suspect commit reproduce most classes of leak.
3. **Preserve:** export the relevant logs and audit entries before their retention runs out.
4. **Notify:** legal, data-protection and customer communication according to 04 §16 (72-hour regulatory notification; processor → controller notice without undue delay).
5. **Fix**
   - Add a regression test to the isolation registry before the fix merges.
   - Run a human security review of the fix (protected paths).

## R2 · Privileged account compromise (SEV1)

1. Use the "This wasn't me" link, or as an admin revoke all sessions for the user (`revokeAllSessions`).
2. Disable the Google Workspace account.
3. Review the platform and agency audit logs for actions after the compromise. Pay special attention to:
   - `billing.gateway_configured` (credential swap, T27);
   - domain changes;
   - agency and workspace status changes.
4. **If gateway credentials changed:**
   - restore the correct ones;
   - rotate them in the gateway dashboard;
   - check payouts with the gateway.
5. **If domains changed:** revert the canonical host and remove any foreign domain.

## R3 · Payment manipulation / webhook abuse (SEV1)

1. **Signals:** `payment.webhook_invalid_signature` spikes, unexpected `billing.state_changed`, or `payment.reconciliation_drift`.
2. Entitlements follow gateway state only, so a forged webhook can't grant a plan (TC-BILL-003). Run `reconcileBilling` manually (Functions console → `billingReconciliation` → Run now) to restore the true state everywhere.
3. If an agency's webhook secret leaked, the agency owner rotates it in the gateway dashboard and in the partner console. The console change is audited, and the agency owner receives an email alert.

## R4 · Outage / elevated 5xx (SEV1 if full, else SEV2)

1. Check `/api/health`, the Vercel status page and the GCP status page.
2. If the outage started with a deploy, roll back.
3. **If Firestore is unavailable:** wait for recovery. The app returns safe errors with request IDs, and no writes are lost (they were rejected, not queued).
4. **If the Redis rate-limit store is unavailable** (`rate_limit.store_unavailable`):
   - sign-ins are refused (fail closed), but signed-in users continue;
   - check the Upstash status page;
   - as a last resort, the owner may approve a temporary higher per-IP limit. **Never switch production to memory** (the validator refuses it).

## R5 · Email not delivered

1. **Signals:** `mail.delivery_failed`, the provider dashboard, bounce and complaint rates.
2. Check DNS (SPF/DKIM/DMARC), provider status and the API key secret.
3. The outbox retries; messages stay queued for up to 30 days.

## R6 · Data loss / corruption

Follow [T-10-04](T-10-04-restore-drill.md) and the recovery procedures in 03 §13:
1. a PITR read of the affected documents, or a restore into a new database;
2. a reviewed copy-back;
3. **re-apply erasures** (`pnpm restore:drill`, R-09).

## On-call rota (template)

| Week | Primary | Secondary | Owner escalation |
|---|---|---|---|
| | | | |

- Pages go to the primary, and to the secondary after 15 min.
- During hypercare (T-11-05), review the dashboards daily.
- **Tabletop exercise before go-live:** walk through R1 and R3 with the team, and record the outcome below.

| Date | Scenario | Participants | Findings |
|---|---|---|---|
| | | | |
