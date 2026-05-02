# Fly.io Migration — Execution Plan (Locked)

> **Durable copy of the plan worked through interactively.** Mirror of `~/.claude/plans/walk-me-through-making-proud-garden.md` so it lives in git.
>
> Companion to `docs/FLY_MIGRATION.md` (the full playbook). This file is the locked-in decision record + concrete execution steps; the playbook has the prose rationale.

## Context

The mulm BAP app (`bap.basny.org`) currently runs on AWS EC2 free tier, which is expiring. We're migrating to Fly.io while keeping SQLite + the existing Litestream → Cloudflare R2 replication.

## Hard Constraint: Zero Production Contact Until Cutover

The entire Fly stack is built, deployed, and verified **without touching production at all**. Production keeps running unchanged on EC2 throughout Phases 0–2. The only prod-side actions occur during the brief Phase 3 cutover window.

**What we read from, but never modify, in prod-adjacent systems:**
- Cloudflare R2 replica bucket `basny-db-replica` (read-only `litestream restore` from local dev machine or the Fly machine).
- Local copy of `config.production.json` already on the user's machine.

**What we never do until Phase 3 cutover:**
- SSH to the EC2 box.
- Modify, stop, or restart anything on EC2.
- Touch the EC2 cron jobs, nginx, certbot, sendmail.
- Change DNS at the registrar.
- Rotate any credentials.

## Decisions (Locked)

### Environmental Facts
| Item | Answer | Implication |
|---|---|---|
| `basny.org` DNS host | Another registrar (not Route53/Cloudflare) | Cutover requires logging into the registrar's DNS panel. No AWS DNS cleanup in Phase 5. |
| EC2 box contents | BAP only (app + nginx + certbot + cron) | Phase 5 can terminate the instance cleanly. |
| R2 access model | Single-owner | No key-rotation urgency. Existing R2 credentials in `config.production.json` reused on Fly as-is. |
| WebAuthn `rpID` | `bap.basny.org` exactly | Existing passkeys keep working post-cutover. |

### Fly Deployment Knobs
| Item | Choice | Rationale |
|---|---|---|
| Machine | `shared-cpu-1x` @ 2GB RAM | Headroom for sharp/imports. |
| Run mode | Scale-to-zero (`auto_stop_machines = "stop"`, `min_machines_running = 0`) | Cold start ~1–3s on first request after idle. |
| Region | `ewr` (Newark) | Matches East-coast user base. |
| Volume | 1GB at `/mnt/app-data` | SQLite is small; single volume = single writer (correct). |
| Config delivery | Fly secret `CONFIG_JSON` materialized to `/app/src/config.json` at boot | One secret, no code changes. |
| MCP (port 3001) | Drop external exposure | Accessible only via `flyctl ssh console`. |
| Backups | Litestream + R2 object versioning (~30-day retention) | Replaces all four cron backup tiers. |
| Daily level sweep | Fly scheduled machine that POSTs to authenticated `/admin/run-sweep` nightly at 6am ET | Reliable despite scale-to-zero. |
| Uptime monitoring | None | External pings would defeat scale-to-zero savings. |

### Cost (estimated)
- Fly volume 1GB: ~$0.15/mo (always)
- Stopped-machine rootfs: ~$0.15–0.30/mo (always)
- Compute when awake: pay-as-you-go (~$0 idle, ~$3–4/mo with light traffic)
- Daily sweep machine: a few cents/mo
- **Total: ~$0.50–1/mo idle, ~$3–4/mo with use**, vs. ~$15–25/mo on post-free-tier EC2.

## Files Touched by This Migration

| Path | Phase | Change |
|---|---|---|
| `fly.toml` (new) | 0 | Top-level Fly config. |
| `start.sh` | 0 | Materialize `config.json` from `$CONFIG_JSON` secret; `set -e`; ensure DB dir exists. |
| `docs/FLY_MIGRATION_EXECUTION.md` (this file) | 0 | Durable plan. |
| `infrastructure/sync-db-from-production.sh` | 4 | Rewrite to pull from R2 via `litestream restore`. |
| `src/routes/admin/run-sweep.ts` (new, if needed) | 4 | Authenticated trigger for daily sweep. |
| `CLAUDE.md` | 4 | Replace EC2/AWS ops references with `flyctl`. |
| `infrastructure/` (CDK directory) | 5 | Delete after stability confirmed. |
| `docker-compose.prod.yml`, `nginx/`, certbot config | 5 | Delete. |
| `infrastructure/CRONTAB.md`, `SENDMAIL_CONFIGURATION.md`, `TAILSCALE_MIGRATION.md`, `CDK_SAFETY.md` | 5 | Archive/delete — moot post-migration. |

## Execution Phases

**Phases 0–2 occur with zero prod contact.** Phase 3 is the first and only time prod is touched.

### Phase 0 — Local prep *(no prod contact)*
1. Write `fly.toml` (template below).
2. Patch `start.sh` (target shape below).
3. Local docker build smoke test:
   ```bash
   docker build -t basny-bap:local .
   docker run --rm -p 4200:4200 \
     -e CONFIG_JSON="$(cat ~/path/to/config.production.json)" \
     -v $(pwd)/.fly-volume-test:/mnt/app-data \
     basny-bap:local
   curl -f http://localhost:4200/health
   ```

### Phase 1 — Staging on Fly *(no prod contact)*
```bash
flyctl auth login
flyctl apps create basny-bap
flyctl volumes create basny_data --region ewr --size 1
flyctl secrets set CONFIG_JSON="$(cat ~/path/to/config.production.json)" --app basny-bap
flyctl deploy --app basny-bap
flyctl logs --app basny-bap   # expect "Restore complete."
curl -f https://basny-bap.fly.dev/health
```

### Phase 2 — Dry run *(no prod contact)*
Destroy/recreate Fly volume to rehearse Litestream restore from R2 a second time. Time the sequence. Verify row counts match prod (within Litestream replication lag).

### Phase 3 — Cutover *(first prod contact, ~5 min maintenance window)*
1. Stop EC2 app container (freezes writes).
2. Wait ~30s for final Litestream replication to flush.
3. On Fly: delete the local DB and force a fresh `litestream restore`.
4. Verify row counts on Fly match the last EC2 numbers exactly.
5. `flyctl certs add bap.basny.org`.
6. Flip DNS at the registrar to point `bap` at Fly. Pre-lower TTL to 60s an hour beforehand.
7. Wait for cert issuance (~1–2 min after DNS resolves).
8. Smoke test on production hostname (passkey login + test submission).
9. Leave EC2 **stopped but not terminated** for 24–48h — rollback insurance.

### Phase 4 — Hardening
1. Enable R2 object versioning on `basny-db-replica` (~30-day retention).
2. Set up daily-sweep Fly scheduled machine (see "Daily-Sweep Mechanism" below).
3. Rewrite `sync-db-from-production.sh` to pull from R2 via `litestream restore`.
4. Update `CLAUDE.md` ops references.

### Phase 5 — AWS decommission *(after 7 days stable)*
1. Final EBS snapshot to local cold storage.
2. Terminate EC2 instance.
3. Delete EBS volume.
4. Delete IAM roles / instance profiles specific to BAP.
5. Delete CloudWatch alarms / metrics / log groups.
6. Archive/delete `infrastructure/` CDK code.
7. Leave AWS account open one billing cycle to confirm $0.

## fly.toml (locked template)

```toml
app = "basny-bap"
primary_region = "ewr"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  PORT = "4200"

[[mounts]]
  source = "basny_data"
  destination = "/mnt/app-data"
  initial_size = "1gb"

[http_service]
  internal_port = 4200
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

  [http_service.concurrency]
    type = "requests"
    soft_limit = 100
    hard_limit = 200

  [[http_service.checks]]
    interval = "30s"
    timeout = "5s"
    grace_period = "30s"
    method = "get"
    path = "/health"

[[vm]]
  size = "shared-cpu-1x"
  memory = "2gb"
  cpus = 1
```

## start.sh (target shape)

```sh
#!/bin/sh
set -e

# Materialize config.json from Fly secret (no-op locally if file already exists)
if [ -n "$CONFIG_JSON" ] && [ ! -f /app/src/config.json ]; then
  printf '%s' "$CONFIG_JSON" > /app/src/config.json
fi

export LITESTREAM_ACCESS_KEY_ID=$(jq -r '.storage.s3AccessKeyId' /app/src/config.json)
export LITESTREAM_SECRET_ACCESS_KEY=$(jq -r '.storage.s3Secret' /app/src/config.json)

mkdir -p /mnt/app-data/database

if [ ! -f /mnt/app-data/database/database.db ]; then
  echo "No database found, attempting restore from Litestream replica..."
  if litestream restore -config /etc/litestream.yml /mnt/app-data/database/database.db; then
    echo "Restore complete."
  else
    echo "No replica found in R2 (first deploy or empty bucket), starting fresh."
  fi
fi

exec litestream replicate -config /etc/litestream.yml -exec "node src/index.js"
```

## Daily-Sweep Mechanism

1. Add (or reuse) an authenticated `POST /admin/run-sweep` route. Auth via Fly secret `SWEEP_TOKEN` checked against `Authorization: Bearer ...` header.
2. Create a Fly scheduled machine that runs nightly at 06:00 ET and POSTs:
   ```bash
   flyctl machine run --schedule daily \
     --region ewr \
     --restart no \
     curlimages/curl:latest \
     -- -X POST -H "Authorization: Bearer $SWEEP_TOKEN" https://bap.basny.org/admin/run-sweep
   ```

Investigate first whether an HTTP-triggerable sweep route already exists.

## Verification Steps

**After Phase 1 (staging)**
- `curl -f https://basny-bap.fly.dev/health` returns 200.
- `flyctl ssh console -C "sqlite3 /mnt/app-data/database/database.db 'SELECT COUNT(*) FROM members;'"` matches production.
- `flyctl ssh console -C "litestream snapshots -config /etc/litestream.yml /mnt/app-data/database/database.db"` lists snapshots.
- Manually browse staging URL (passkeys won't work — wrong origin — use password); submit a test record; confirm it persists.

**After Phase 3 (cutover)**
- `curl -f https://bap.basny.org/health` returns 200.
- Row counts on Fly match the last EC2 numbers exactly.
- Log in with a passkey on production hostname → succeeds.
- Submit a real test record → appears in DB → Litestream replication confirmed.

**After Phase 4 (hardening)**
- R2 bucket versioning enabled (Cloudflare dashboard).
- Daily sweep scheduled machine fires at the expected time.
- `npm run sync-db` (rewritten) successfully pulls a copy of prod into local `db/database.db`.

**After Phase 5 (decommission)**
- AWS billing dashboard shows $0 charges next cycle.
- `dig bap.basny.org` resolves to Fly anycast IPs only.

## Rollback

See `docs/FLY_MIGRATION.md` § "Rollback Plan". Forward-only rule: once writes occur on Fly, never restart EC2 without restoring Fly's data first.

## Open Items (non-blocking)

- Investigate whether the existing daily level sweep already has an HTTP trigger before adding `/admin/run-sweep`.

## Architecture Update: Permanent Staging Environment

The plan was extended mid-execution to add a permanent staging environment alongside production. This eliminates the risk of staging clobbering prod's R2 generation (which we narrowly avoided once during Phase 1 testing) and gives us a refreshable preview of prod-shaped data.

### Staging vs. Production

| | Production (`basny-bap`) | Staging (`basny-bap-staging`) |
|---|---|---|
| Fly app | `basny-bap` | `basny-bap-staging` |
| Volume | `vol_vwn2z9qwg73m818v` | `vol_rnzy196dexxzp78r` |
| URL | `bap.basny.org` *(post-cutover)* | `basny-bap-staging.fly.dev` |
| `STAGING` env var | unset | `STAGING=1` |
| Litestream behavior | restore (boot) + **replicate** (continuous) | restore (boot) only — **never replicates** |
| Config overrides | none | URLs → `*.fly.dev`, `email.disableEmails=true` |
| Refresh source | continuous WAL from local SQLite | manual: wipe local DB → restart → restore from prod's R2 generation |

### How `start.sh` distinguishes them

```sh
if [ "$STAGING" = "1" ]; then
  echo "STAGING mode: skipping Litestream replicate."
  exec node src/index.js
else
  exec litestream replicate -config /etc/litestream.yml -exec "node src/index.js"
fi
```

Both branches still run `litestream restore` on first boot if the DB is missing — `restore` is read-only on R2.

### Refreshing staging from prod

```bash
flyctl ssh console --app basny-bap-staging -C "rm /mnt/app-data/database/database.db /mnt/app-data/database/database.db-* 2>/dev/null; true"
flyctl machine restart <machine-id> --app basny-bap-staging
```

On next boot, `start.sh` sees no DB → `litestream restore` from the prod generation in R2 → staging gets a fresh copy of prod data.

## Progress

- [x] Phase 0.1 — `fly.toml` written
- [x] Phase 0.2 — `start.sh` patched (also: `Dockerfile` chown of `/mnt/app-data` to `nodejs:1001`, sqlite CLI added)
- [x] Phase 0.3 — durable plan committed
- [x] Phase 0.4 — local docker build smoke test passed
- [x] Phase 1 — staging architecture finalized; permanent `basny-bap-staging` app live at https://basny-bap-staging.fly.dev
- [x] Phase 2 — **dry run successful**: Litestream restore from R2 produced exact match to prod (members=21, submissions=111, species_name_group=2281, sessions=41)
- [x] Phase 2.5 — _(no longer needed: the earlier `start.sh` bug meant `LITESTREAM_*` env vars were empty, so the panicked-about staging runs never actually wrote to R2; prod's generation is untouched)_
- [ ] Phase 3 — cutover (set real prod `CONFIG_JSON` on `basny-bap`, force fresh restore, DNS flip)
- [ ] Phase 4 — hardening
- [ ] Phase 5 — AWS decommission

## Known Issues Surfaced During Phase 1

- ~~**`src/sessions.js:8` queries DB before async init completes on cold boot.**~~ **Fixed.** `src/index.ts` now `await`s the `ready` promise from `db/conn.ts` before calling `app.listen`. Failure causes `process.exit(1)` so Fly visibly restarts on bad init.
- ~~**Secret-derived `CONFIG_JSON` was never being written at runtime.**~~ **Fixed.** `start.sh` previously only wrote `/app/src/config.json` if it didn't exist; the Dockerfile builder bakes in `config.sample.json` for tsc, so the file always existed and the secret was ignored. Now `start.sh` always overwrites when `CONFIG_JSON` is set. Verified: staging boots with real prod R2 creds and Litestream restore succeeds.

## What `basny-bap` Looks Like Now

- App created (Phase 1), volume `vol_vwn2z9qwg73m818v` exists, machine destroyed.
- `CONFIG_JSON` secret is the staging-overrides version from earlier iterations — **must be re-set with the real prod config (no overrides) before Phase 3 cutover**.
- Cutover step: `flyctl secrets set CONFIG_JSON="$(ssh BAP 'sudo cat …')" --app basny-bap`, then `flyctl deploy --app basny-bap`.
