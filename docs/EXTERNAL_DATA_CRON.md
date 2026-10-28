# External data enrichment as an off-box cron job

Wikipedia/Wikidata and GBIF enrichment doesn't run on the prod machine. A machine you control (a laptop or a home server) runs it in three steps:

1. Restore a local copy of prod's database from the Litestream replica.
2. Run the sync scripts against that copy.
3. Push what changed to prod over the [admin API](ADMIN_API.md) with `scripts/push-external-data.ts`.

Prod's database is only written in step 3, one `PUT /api/admin/species/:id/external-data` per Species that differs.

## One-time setup

On the machine that runs the job:

- A checkout of this repo on `main`, with `npm ci` done (`SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm ci` if a system libvips gets in the way).
- `litestream`, `jq` and `sqlite3`, plus R2 credentials for the restore. [`.claude/commands/sync-db.md`](../.claude/commands/sync-db.md) and `infrastructure/sync-db-from-production.sh` say what's needed and where the credentials come from. Don't copy secrets into this repo.
- An admin API token in `~/.config/basny/admin-token`, mode 600. See [Minting a token](ADMIN_API.md#minting-a-token); name it after the machine, e.g. `--name enrichment-cron`. The pusher refuses a token file that group or others can read. Instead of the file you can set `BASNY_ADMIN_TOKEN`.

## The steps by hand

```bash
cd ~/src/mulm   # the checkout

# 1. Refresh db/database.db from prod's replica (your old copy goes to backups/)
./infrastructure/sync-db-from-production.sh

# 2. Enrich it. Record the start time first: step 3 pushes what was synced since then.
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
npm run script scripts/sync-wikipedia-all-species.ts -- --execute
npm run script scripts/sync-gbif-all-species.ts -- --execute

# 3. See what would change on prod, then push it
npm run script scripts/push-external-data.ts -- --since="$START"
npm run script scripts/push-external-data.ts -- --since="$START" --execute
```

Leave `--download-images` off the sync scripts. It uploads to the prod R2 bucket from your machine, and the pusher sends URLs only.

`scripts/README_EXTERNAL_DATA.md` covers the sync scripts' own options.

## The pusher

```bash
npm run script scripts/push-external-data.ts -- <selection> [--execute] [--db=PATH] [--url=URL] [--delay-ms=N]
```

| Selection | Pushes |
|---|---|
| `--species-id=N` | one Species |
| `--since=<ISO date>` | Species whose local `last_external_sync` is at or after the date |
| `--all` | every Species in the local database |

It is a dry-run unless you pass `--execute`. For each Species it GETs prod's copy and compares the external references and image links with the local ones, order included. Only a Species that differs is written, with both lists; each replaces prod's list.

It skips and reports:

- a Species prod doesn't have;
- a Species whose Canonical name differs between the two. The local copy is older than prod, so the same `group_id` may name another Species by now;
- a push that would empty a list prod has. That is more likely a stale copy than a real removal; clear it with the API by hand if you mean it.

Output is one line per Species (`same`, `would`, `updated`, `skip`, `FAILED`), with `+`/`-` lines for what changes, then a summary:

```
checked 412, unchanged 398, updated 11, skipped 3, failed 0
```

Exit status is `0` when nothing failed, `1` when any Species failed, and `2` for bad usage or a missing or rejected token. A rejected token (`401`/`403`) stops the run at once.

The remote is `--url`, else `BASNY_API_URL`, else `https://bap.basny.org`. Requests are 600 ms apart (`--delay-ms`), under the API's limit of 120 a minute per IP. On a `429` it waits for `Retry-After` and retries, up to 5 times. The token is never printed.

Image attribution, license and title don't reach prod. The API takes image URLs only, so an image list that changes is stored on prod without that metadata.

## Cron

A wrapper that runs all three steps and logs each run, saved as `~/bin/basny-enrichment.sh` and made executable:

```bash
#!/bin/bash
# Off-box external data enrichment for bap.basny.org. See docs/EXTERNAL_DATA_CRON.md.
set -euo pipefail

REPO="$HOME/src/mulm"
LOG_DIR="$HOME/.local/state/basny-enrichment"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date +%Y%m%d-%H%M%S).log"
exec >>"$LOG" 2>&1

cd "$REPO"
git pull --ff-only --quiet
echo "== $(date -u +%FT%TZ) start at $(git rev-parse --short HEAD)"

./infrastructure/sync-db-from-production.sh
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
npm run --silent script scripts/sync-wikipedia-all-species.ts -- --execute
npm run --silent script scripts/sync-gbif-all-species.ts -- --execute
npm run --silent script scripts/push-external-data.ts -- --since="$START" --execute

echo "== $(date -u +%FT%TZ) done"
find "$LOG_DIR" -name '*.log' -mtime +60 -delete
```

`set -e` stops the run at the first failing step, so a failed refresh never leads to a push from an old copy. The pusher's non-zero exit on any failed Species ends the run as failed too.

Crontab line (`crontab -e`), Sundays at 03:30 local time:

```
30 3 * * 0 PATH=/usr/local/bin:/usr/bin:/bin $HOME/bin/basny-enrichment.sh || echo "basny enrichment failed, see ~/.local/state/basny-enrichment" | mail -s "basny enrichment failed" you@example.com
```

Use any alert that reaches you in place of `mail`. Cron's `PATH` is minimal; add wherever `node`, `npm` and `litestream` live (e.g. a version manager's bin directory).

Weekly is enough. Each refresh replaces the local `external_data_sync_log` with prod's, so the sync scripts treat every Species as due and a run covers the whole catalogue. Add `--batch-size=N` to the sync scripts to cap a run.

## Trying it on staging

Point the pusher at staging with a staging token (minted for `baptest+admin@porcnick.com`, see [Staging](ADMIN_API.md#staging)):

```bash
BASNY_ADMIN_TOKEN=$(cat /path/to/staging-token) \
  npm run script scripts/push-external-data.ts -- --species-id=61 --url=https://basny-bap-staging.fly.dev
```

Staging's database is a copy of prod's, so a local copy of prod matches it closely enough to test against.
