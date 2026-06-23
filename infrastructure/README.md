# Infrastructure

This directory holds operational notes for the BAP platform. Production runs on
**Fly.io** (it was previously AWS EC2; that setup is gone).

**Production URL**: https://bap.basny.org

## Canonical Docs

The authoritative references live under `docs/`:

- **[`docs/INFRASTRUCTURE.md`](../docs/INFRASTRUCTURE.md)** — topology, Fly apps
  (`basny-bap` / `basny-bap-staging`, region `ewr`), the `/mnt/app-data` volume,
  Litestream→R2 backups, the `CONFIG_JSON` secret, storage, and common ops
  commands.
- **[`docs/DEPLOY.md`](../docs/DEPLOY.md)** — the deploy runbook: `flyctl deploy`
  to staging first, then prod, with smoke checks, rollback, and migrations.

Start there. The notes in this directory are supplementary and link back to those
two files for anything load-bearing.

## What's in this directory

- **[`sync-db-from-production.sh`](./sync-db-from-production.sh)** — pull the
  production database into local development. There is no SSH box anymore; the
  script restores the latest Litestream snapshot from the Cloudflare R2 bucket
  `basny-db-replica`. It produces a consistent point-in-time copy and never
  touches the running prod machine. Requires `litestream`, `jq`, `sqlite3`, and
  `src/config.json` with R2 creds under `.storage`.
- **[`DATABASE_MONITORING.md`](./DATABASE_MONITORING.md)** — health and integrity
  checks on Fly (`GET /health`, `flyctl status`/`logs`, Litestream replica
  inspection).
- **[`CRONTAB.md`](./CRONTAB.md)** — note on scheduled jobs. DB backups are now
  continuous via Litestream (no cron), so the old EC2 crontab is retired.
- **[`SENDMAIL_CONFIGURATION.md`](./SENDMAIL_CONFIGURATION.md)** — how the app
  sends email on Fly (SMTP settings live in the `email` block of the
  `CONFIG_JSON` secret; ssmtp-on-EC2 is gone).
- **[`TAILSCALE_MIGRATION.md`](./TAILSCALE_MIGRATION.md)** — superseded. Fly has
  no public SSH box; shell access is `flyctl ssh console`, so Tailscale is no
  longer part of the access model.

## Access at a glance

```bash
flyctl logs --app basny-bap        # tail logs
flyctl status --app basny-bap      # running release + health checks
flyctl ssh console --app basny-bap # shell on the live machine
```

See `docs/INFRASTRUCTURE.md` for the full command reference.
