# Scheduled Jobs (Fly.io)

How scheduled/automated work is handled now that production runs on Fly.io. See
[`docs/INFRASTRUCTURE.md`](../docs/INFRASTRUCTURE.md) for topology.

> **The EC2 crontab is retired.** There is no long-lived host, no `ec2-user`/root
> crontab, and no `crond`. The jobs that used to live in cron are either gone
> (replaced by Fly mechanisms) or no longer have a documented scheduled
> equivalent.

## Database backups — no cron needed

The old crontab's main job was rotating SQLite backups
(hourly/daily/weekly/monthly to an EBS volume). **That's gone.** Production now
replicates the database **continuously** via Litestream to the Cloudflare R2
bucket `basny-db-replica` — every WAL write streams to R2, so there is no backup
window and nothing to schedule.

- Durability: continuous Litestream replication (not periodic snapshots).
- Restore: on boot, `start.sh` runs `litestream restore` from R2 if the local DB
  is missing; for local dev use `infrastructure/sync-db-from-production.sh`.
- Inspect replica state:
  ```bash
  flyctl ssh console --app basny-bap \
    -C "litestream snapshots -config /etc/litestream.yml /mnt/app-data/database/database.db"
  ```

See [`DATABASE_MONITORING.md`](./DATABASE_MONITORING.md) and the "Litestream"
sections of `docs/INFRASTRUCTURE.md`.

## Health monitoring — no cron job

The EC2 crontab pushed a health metric every 5 minutes and ran a daily integrity
check. On Fly:

- Liveness is handled by Fly's own `GET /health` check — Fly polls it and only
  serves a machine that's passing. Check it with `flyctl status --app basny-bap`.
- Run an on-demand integrity check whenever you need one (see
  `DATABASE_MONITORING.md`); there's no scheduled job for it.

## Docker cleanup — not applicable

There are no long-lived Docker images accumulating on a host. Each deploy
provisions a fresh machine from the `Dockerfile`, so the weekly `docker system
prune` job has no purpose here.

## Species external-data sync — runs off-box

Wikipedia/Wikidata and GBIF enrichment does not run on Fly. The app has no
in-app sync or admin page for it (removed in #461). Run the
`scripts/sync-*.ts` scripts locally or from a cron job on another machine; see
[`scripts/README_EXTERNAL_DATA.md`](../scripts/README_EXTERNAL_DATA.md).
A run updates only the database it is pointed at, plus any R2 image uploads; `scripts/push-external-data.ts` pushes the results to prod through the admin API. See [`docs/EXTERNAL_DATA_CRON.md`](../docs/EXTERNAL_DATA_CRON.md) for the crontab.

## Other scheduled jobs

If another periodic task becomes a requirement, decide on a mechanism and
document it in [`docs/INFRASTRUCTURE.md`](../docs/INFRASTRUCTURE.md). The
infrastructure docs don't specify a Fly-native scheduler for this app; don't
assume one exists.

## References

- [`docs/INFRASTRUCTURE.md`](../docs/INFRASTRUCTURE.md) — topology, Litestream,
  ops commands
- [`DATABASE_MONITORING.md`](./DATABASE_MONITORING.md) — health and replica checks
- [`SENDMAIL_CONFIGURATION.md`](./SENDMAIL_CONFIGURATION.md) — app email config
