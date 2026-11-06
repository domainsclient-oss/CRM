# T-10-04 — Backup restore drill (NFR-REL-002, TC-REL-001)

Quarterly after launch, and once in staging before launch. Targets: RPO ≤ 1 h, RTO ≤ 4 h. Record every run in the table at the end.

## Prerequisites

- PITR and daily backups are enabled on the staging database ([10 §9](../10-ci-cd-and-deployment.md#9-backups-and-disaster-recovery)).
- The operator has `roles/datastore.owner` on staging only, using ADC (`gcloud auth application-default login`).
- Some recent erasures exist: erase a test contact *after* the backup you will restore.

## Steps

1. **Start the clock.** Note the time T0.
2. **Pick the backup.** Choose the latest daily backup and note its time (`BACKUP_TIME`).

   ```bash
   gcloud firestore backups list --location=<region>
   ```

3. **Restore it into a new database.** Never restore over an existing one.

   ```bash
   gcloud firestore databases restore --source-backup=<backup> --destination-database=restore-$(date +%Y%m%d)
   ```

   Wait for the operation to finish (`gcloud firestore operations list`). Note the time T1.
4. **Verify the restored database and re-apply erasures** (R-09):

   ```bash
   FIRESTORE_DATABASE_ID=restore-YYYYMMDD FIREBASE_PROJECT_ID=<staging project> APP_ENV=staging \
     pnpm restore:drill --source "(default)" --backup-time <BACKUP_TIME> --dry-run
   ```

   Review the report:
   - **Count mismatches:** these are expected only for collections written after `BACKUP_TIME`.
   - **Checksum mismatches:** expected only for documents changed after it.
   - **`erasures.erased`:** must equal the number of contacts erased after the backup that exist in the restored copy.

   If the report looks right, run the same command again without `--dry-run`. A further run must report `erased: 0`, because re-application is idempotent.
5. **Payment reconciliation.** Run it against the restored copy once Phase 6b ships. Until then, mark it N/A.
6. **Point a test deployment at the restored copy** (optional, full DR rehearsal): set `FIRESTORE_DATABASE_ID` on a preview deployment, then sign in and check a few records. Note the time T2.
7. **Clean up.** Delete the restored database once the record is complete.

   ```bash
   gcloud firestore databases delete --database=restore-YYYYMMDD
   ```

## Results

| Date | Backup time | Restore duration (T1−T0) | Verification | Erasures re-applied | Total (T2−T0) | Within RTO? | Operator |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

The tooling (`compareDatabases`, `reapplyErasures`, `scripts/restore-drill.ts`) is tested against the emulator in `packages/core/src/restore.int.test.ts`. It was also smoke-run on the emulator (2026-11-04).
