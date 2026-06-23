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

## Other scheduled jobs (e.g. external-data sync)

If a genuinely periodic task is still needed (for example, the species
external-data sync scripts under `scripts/`), note that **the source
infrastructure docs do not specify a Fly-native cron/scheduler mechanism** for
this app. Don't assume one exists. Options, none of which are currently
documented here:

- Run the script manually/locally when needed (`npm run script scripts/<name>.ts`).
- If a recurring schedule becomes a requirement, decide on and document a
  mechanism (e.g. an external scheduler invoking the work) — and update
  `docs/INFRASTRUCTURE.md` as the canonical reference at that time.

Until then, treat these as manual operations and refer to
[`docs/INFRASTRUCTURE.md`](../docs/INFRASTRUCTURE.md).

## References

- [`docs/INFRASTRUCTURE.md`](../docs/INFRASTRUCTURE.md) — topology, Litestream,
  ops commands
- [`DATABASE_MONITORING.md`](./DATABASE_MONITORING.md) — health and replica checks
- [`SENDMAIL_CONFIGURATION.md`](./SENDMAIL_CONFIGURATION.md) — app email config
