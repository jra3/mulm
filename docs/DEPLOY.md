# Deploying to Production (Fly.io)

Day-to-day runbook for shipping a code change to https://bap.basny.org.

For topology, costs, and infra reference, see [`INFRASTRUCTURE.md`](./INFRASTRUCTURE.md).

## Prerequisites (one-time)

```bash
brew install flyctl              # or: curl -L https://fly.io/install.sh | sh
flyctl auth login                # account: nop@porcnick.com, org: personal
flyctl apps list | grep basny    # confirm you can see basny-bap and basny-bap-staging
```

## Standard Bugfix Flow

1. **Branch, commit, open PR** — work on a feature branch, not `main`.
2. **Tests pass locally** — `npm test` and `npm run lint`.
3. **Merge to `main`** — CI runs, branch protection enforces it.
4. **Deploy to staging first** (see below).
5. **Smoke-check staging**, then deploy to prod.
6. **Verify prod**, watch logs for ~1 minute.

```bash
# From main, with a clean tree:
git checkout main && git pull

# 1. Stage
flyctl deploy --config fly.staging.toml --app basny-bap-staging
# Smoke check (see one-liner below), exercise the change at
# https://basny-bap-staging.fly.dev, then proceed to prod.

# 2. Prod
flyctl deploy --app basny-bap
flyctl status --app basny-bap               # confirm checks are passing
curl -sf https://bap.basny.org/health       # 200 = good
flyctl logs --app basny-bap                 # tail for ~1 min
```

`flyctl deploy` builds the `Dockerfile` remotely, releases a new machine version, runs the `/health` check, and only flips traffic once the new machine is healthy. A failed health check leaves the previous version serving.

### Smoke check one-liner

Use the same curl block for staging and prod, just swap the host:

```bash
HOST=https://bap.basny.org    # or https://basny-bap-staging.fly.dev
curl -sf -o /dev/null -w "health %{http_code}\n" "$HOST/health"
curl -s -o /tmp/home.html -w "/ %{http_code}\n" "$HOST/"
curl -s -o /tmp/activity.html -w "/activity %{http_code}\n" "$HOST/activity"
```

### Expected warnings

On a deploy to a scale-to-zero app whose machine was cold, you'll see this once during rollout:

```
WARNING The app is not listening on the expected address and will not be reachable by fly-proxy.
```

It's transient — `flyctl` is checking the listener before Node has bound to `0.0.0.0:4200`. As long as the subsequent line is `✔ Machine <id> is now in a good state` and `flyctl status` shows `1 total, 1 passing` checks, ignore it. If checks stay failing past a minute, that's a real problem — see Rollback below.

## Refreshing Staging Data First (optional)

Staging restores read-only from prod's Litestream replica. If you want fresh prod data before testing:

```bash
MACHINE=$(flyctl machines list --app basny-bap-staging --json | jq -r '.[0].id')
flyctl ssh console --app basny-bap-staging \
  -C "rm -f /mnt/app-data/database/database.db /mnt/app-data/database/database.db-shm /mnt/app-data/database/database.db-wal"
flyctl machine restart "$MACHINE" --app basny-bap-staging
```

On next boot, `start.sh` finds no DB and runs `litestream restore` from R2.

## Rollback

Fly keeps prior releases. To revert:

```bash
flyctl releases --app basny-bap            # find the previous version number
flyctl releases rollback <version> --app basny-bap
```

For an emergency rollback when a deploy is mid-flight, the prior machine version stays healthy — the new release simply isn't promoted, and you can cancel with `flyctl releases rollback`.

## Database Migrations

Migrations in `db/migrations/NNN-*.sql` run automatically on app boot (see `start.sh`). For a deploy that includes a migration:

- Migrations are forward-only — no automatic rollback path.
- Test on staging first (staging restores from prod's replica, so it has prod's schema).
- If a migration fails, the app exits and Fly serves the previous version. Investigate via `flyctl logs --app basny-bap`.

## Verifying a Deploy

```bash
# Health
curl -sf https://bap.basny.org/health

# Recent logs
flyctl logs --app basny-bap

# Currently running release
flyctl status --app basny-bap

# Open a shell on the live machine
flyctl ssh console --app basny-bap

# Inspect the prod DB
flyctl ssh console --app basny-bap -C "sqlite3 /mnt/app-data/database/database.db"
```

## Secrets / Config Changes

Code lives in the `Dockerfile`; runtime config lives in the `CONFIG_JSON` Fly secret. To change config without a code deploy:

```bash
flyctl secrets set CONFIG_JSON="$(cat config.production.json)" --app basny-bap
```

Setting a secret triggers a rolling restart automatically.

## What `flyctl deploy` Does Under the Hood

1. Tars your working tree (respecting `.dockerignore`) and uploads to Fly's remote builder.
2. Builds the image from `Dockerfile`.
3. Provisions a new machine in `ewr` with the new image, mounts the `basny_data` volume.
4. Runs `start.sh`: materializes `CONFIG_JSON` → `src/config.json`, restores DB from R2 if missing, starts Litestream + Node.
5. Polls `GET /health` until healthy (or fails the deploy).
6. Routes traffic to the new machine; stops the old one.

Because the app has `auto_stop_machines = "stop"` and `min_machines_running = 0`, the prod machine may be cold when a deploy starts — that's fine, Fly handles it.
