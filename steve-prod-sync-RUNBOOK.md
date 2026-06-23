# Steve Matassa Backfill → Production Runbook

Applies the 69 historical submissions (verified locally) to the production DB on
Fly.io, via a surgical SQL patch. The app keeps running; Litestream replicates
the change to R2 automatically.

**I can't run these — no `flyctl` here. You execute; I prepared & rehearsed everything.**

Artifacts (in repo root):
- `steve-prod-patch.sql` — the INSERTs (44 species groups, 68 common + 48 scientific names, 69 submissions) + Steve's level UPDATE, wrapped in one transaction.
- `steve-prod-driftcheck.sql` — pre-flight; every row must say `OK`.

The patch uses **explicit row IDs** that assume prod is unchanged since the
2026-06-22 R2 snapshot (max ids: submissions 128, groups 2389, common 7025,
scientific 2345). The drift-check enforces this. **If any row says `DRIFT-ABORT`,
STOP** — prod has new data since the snapshot; tell me and I'll regenerate the
patch from a fresh snapshot.

> Ordering note: apply this **before** the next prod deploy. Prod is at 51
> migrations; migration 053 (`final_submission_on`) hasn't run yet, so the patch
> omits that column. When prod next deploys, migration 053 backfills it
> (`= approved_on`) for Steve's rows too. If prod has *already* deployed 053
> (drift-check shows migrations ≠ 51), tell me — I'll regenerate including it.

---

## 1. Rehearse on STAGING first (disposable — restores from R2, never replicates)

```bash
APP=basny-bap-staging
DB=/mnt/app-data/database/database.db

# put the files on the machine
flyctl ssh sftp put steve-prod-driftcheck.sql /tmp/driftcheck.sql --app $APP
flyctl ssh sftp put steve-prod-patch.sql      /tmp/patch.sql      --app $APP

# drift-check (every row must be OK)
flyctl ssh console --app $APP -C "sh -c 'sqlite3 -box $DB < /tmp/driftcheck.sql'"

# apply (-bail aborts the whole transaction on any error)
flyctl ssh console --app $APP -C "sh -c 'sqlite3 -bail $DB < /tmp/patch.sql'"

# verify: expect coral 730 / fish 230 / plant 270, and 81 total
flyctl ssh console --app $APP -C "sh -c \"sqlite3 -box $DB \\\"SELECT program, SUM(points + IFNULL(article_points,0) + IFNULL(first_time_species,0)*5 + IFNULL(cares_species,0)*5 + IFNULL(flowered,0)*points + IFNULL(sexual_reproduction,0)*points) total, COUNT(*) subs FROM submissions WHERE member_id=13 AND approved_on IS NOT NULL GROUP BY program;\\\"\""
```

Optionally eyeball https://basny-bap-staging.fly.dev/member/13 .

## 2. Apply to PRODUCTION

```bash
APP=basny-bap
DB=/mnt/app-data/database/database.db

# 2a. BACKUP first (snapshot the live DB on the volume)
flyctl ssh console --app $APP -C "sh -c 'sqlite3 $DB \".backup ${DB%.db}-pre-steve-backfill.db\"'"

# 2b. transfer files
flyctl ssh sftp put steve-prod-driftcheck.sql /tmp/driftcheck.sql --app $APP
flyctl ssh sftp put steve-prod-patch.sql      /tmp/patch.sql      --app $APP

# 2c. DRIFT CHECK — every row must read OK. If any says DRIFT-ABORT, STOP.
flyctl ssh console --app $APP -C "sh -c 'sqlite3 -box $DB < /tmp/driftcheck.sql'"

# 2d. APPLY
flyctl ssh console --app $APP -C "sh -c 'sqlite3 -bail $DB < /tmp/patch.sql'"

# 2e. VERIFY (coral 730 / fish 230 / plant 270 ; 81 subs ; levels updated)
flyctl ssh console --app $APP -C "sh -c \"sqlite3 -box $DB \\\"SELECT (SELECT COUNT(*) FROM submissions WHERE member_id=13) subs, fish_level, plant_level, coral_level FROM members WHERE id=13;\\\"\""
```

Confirm at https://bap.basny.org/member/13 . Litestream replicates within seconds
(`flyctl ssh console --app $APP -C "litestream snapshots -config /etc/litestream.yml $DB"`).

## Rollback (if needed)

```bash
# restore the pre-backfill snapshot, then restart the machine
flyctl ssh console --app basny-bap -C "sh -c 'cp ${DB%.db}-pre-steve-backfill.db $DB'"
flyctl machine restart <machine-id> --app basny-bap
```
(Or recover a point-in-time copy locally from R2 with `litestream restore` and re-push.)
