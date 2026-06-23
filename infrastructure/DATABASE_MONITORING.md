# Database Health & Monitoring (Fly.io)

How to check that production and its database are healthy. Production runs on
Fly.io; see [`docs/INFRASTRUCTURE.md`](../docs/INFRASTRUCTURE.md) for topology and
[`docs/DEPLOY.md`](../docs/DEPLOY.md) for the deploy/verify runbook.

There is no SSH box, no `docker exec`, and no EBS-volume backup or cron job to
monitor anymore. Database durability comes from **continuous Litestream
replication** to the Cloudflare R2 bucket `basny-db-replica`, not from scheduled
backups.

## Application Health

```bash
# HTTP health endpoint (200 = healthy)
curl -sf https://bap.basny.org/health

# Running release + health-check status
flyctl status --app basny-bap

# Recent logs
flyctl logs --app basny-bap
```

`flyctl status` reports the check state (e.g. `1 total, 1 passing`). Fly only
routes traffic to a machine once its `GET /health` check passes, so a failed
check leaves the previous version serving.

## Database Integrity

Open a shell on the live machine and run SQLite's integrity check directly
against the volume-backed database:

```bash
flyctl ssh console --app basny-bap \
  -C "sqlite3 /mnt/app-data/database/database.db 'PRAGMA integrity_check;'"
```

A healthy database returns `ok`. You can inspect it interactively too:

```bash
flyctl ssh console --app basny-bap \
  -C "sqlite3 /mnt/app-data/database/database.db"
```

## Litestream Replica Checks

The database replicates continuously to R2. To confirm replication is current,
inspect the replica from inside the machine (config lives at
`/etc/litestream.yml` on the running machine):

```bash
# List snapshots of the prod DB replica
flyctl ssh console --app basny-bap \
  -C "litestream snapshots -config /etc/litestream.yml /mnt/app-data/database/database.db"
```

Healthy output shows recent snapshot generations. If snapshots are stale or
absent, replication has stalled — check `flyctl logs --app basny-bap` for
Litestream errors.

> Replication is only active on **production**. Staging runs with `STAGING=1` and
> restores read-only from R2 on boot; it never replicates back. See the
> "Litestream Behavior by Environment" table in `docs/INFRASTRUCTURE.md`.

## Restore / Recovery

On boot, if the local DB is missing, `start.sh` runs `litestream restore` from R2
automatically — so a fresh or wiped machine self-heals to the latest replicated
state (within replication lag, ~seconds).

To pull the production database into local development:

```bash
litestream restore -config litestream.yml -o db/database.db
# or use infrastructure/sync-db-from-production.sh
```

For staging refresh and full restore mechanics, see the "Refresh Staging from
Prod" and "Common Ops" sections of `docs/INFRASTRUCTURE.md`.

## Alerts

Outbound email (including any alerting the app sends) uses the SMTP settings in
the `email` block of the `CONFIG_JSON` secret — see
[`SENDMAIL_CONFIGURATION.md`](./SENDMAIL_CONFIGURATION.md). The EC2-era
ssmtp/cron alerting pipeline is retired.

## References

- [`docs/INFRASTRUCTURE.md`](../docs/INFRASTRUCTURE.md) — topology, storage, ops
- [`docs/DEPLOY.md`](../docs/DEPLOY.md) — deploy and verify runbook
- [SQLite PRAGMA integrity_check](https://www.sqlite.org/pragma.html#pragma_integrity_check)
- [Litestream](https://litestream.io/)
