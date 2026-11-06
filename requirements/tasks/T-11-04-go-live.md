# T-11-04 — Go-live runbook (v1.0.0, human checkpoint H6)

## T-7 days

1. Release checklist ([13](../13-release-readiness-checklist.md)) has every item ticked with evidence, or an explicit owner waiver.
2. Hardening applied to production (T-11-01):
   - `pnpm ops harden --instance <i> --env production --billing-account <acc> --budget <usd>`: review the dry run, then run with `--apply`.
   - Confirm 2-step verification enforcement for platform staff in Google Workspace (FR-AUTH-008). Keep a screenshot as evidence.
   - Enable Data Access audit logs for Firestore and Secret Manager (IAM → Audit Logs).
3. Monitoring (T-11-02):
   - `pnpm ops monitoring --instance <i> --env production --notify <channel>`: review the dry run, then `--apply`.
   - Fire a test alert to the on-call channel.
4. DNS, certificates and email ready (T-11-03).
5. The latest staging run is green:
   - full regression: `test:coverage`, `test:e2e:auth`, smoke, `perf:lighthouse`, ZAP, k6;
   - restore drill within RTO (T-10-04);
   - UAT signed off (T-10-03).

## Go / no-go (T-1 day)

| Gate | Owner | Go? |
|---|---|---|
| No open SEV1/SEV2; no Critical/High security findings | Eng lead | |
| UAT sign-off from ≥ 3 pilot workspaces | Product | |
| Payments in live mode for the pilot agency, with one real low-value payment refunded successfully | Billing ops | |
| On-call rota staffed for 14 days (T-11-06) | Eng lead | |
| Owner accepts residual risks (no MFA R-15; same-second revocation F-09; OQ-26 upload size decision) | Owner | |

## Rollout (release workflow, one instance at a time)

1. Tag `v1.0.0` from green `main`, then run the **Release** workflow. It waits for production approval (H6).
2. Per instance, in order:
   1. verify backups and note the PITR timestamp;
   2. deploy indexes (wait until READY);
   3. run approved migrations, then deploy rules, then functions;
   4. deploy web and console with `vercel deploy --prebuilt --prod`;
   5. run the **post-deploy smoke**.
3. **If the smoke fails:**
   - `vercel rollback` web and console (≤ 5 min, 10 §8);
   - roll back functions to the previous tag;
   - stop the rollout;
   - page on-call.

## After rollout

- Run `pnpm uat:seed` only on staging. **Never in production.**
- Onboard the pilot agency in production through the console (UC-01/02).
- Announce the launch. Hypercare (T-11-05) starts.
