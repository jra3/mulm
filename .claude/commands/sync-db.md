# Sync Database from Production

Pull the production database into your local development environment by
restoring the latest Litestream snapshot from Cloudflare R2.

## Quick Start

```bash
./infrastructure/sync-db-from-production.sh
```

This script will:
1. Restore the latest replica snapshot from R2 (bucket `basny-db-replica`)
2. Back up your current local database to `backups/`
3. Swap the restored snapshot into place
4. Verify with row-count checks

It does **not** touch the running production machine — the snapshot comes from
the R2 replica that Litestream writes continuously (see `litestream.yml`).

## Requirements

- `litestream` — Arch/Omarchy: `yay -S litestream`
- `jq`, `sqlite3`
- `src/config.json` with R2 creds under `.storage` (the same file the app uses)

## After Sync

Restart your dev server:
```bash
npm run dev
```

Migrations will run automatically on startup.

## How it works (Fly.io era)

Production runs on Fly.io (app `basny-bap`) with no persistent SSH box, so the
old `ssh BAP` + scp flow no longer applies. Litestream replicates the prod DB to
R2; `litestream restore` reconstructs a consistent point-in-time copy.

Key paths:
- Replica identity (in `litestream.yml`): `/mnt/app-data/database/database.db`
- Local DB: `db/database.db`
- Local backups: `backups/` directory

See `infrastructure/sync-db-from-production.sh` for the full implementation.

## Alternative: pull the live file via flyctl

If you need the exact live file rather than the replica snapshot:

```bash
flyctl ssh console --app basny-bap \
  -C "sqlite3 /mnt/app-data/database/database.db '.backup /tmp/live.db'"
flyctl ssh sftp get /tmp/live.db ./db/database.db --app basny-bap
```
