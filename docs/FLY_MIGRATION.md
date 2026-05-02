# Fly.io Migration Playbook

End-to-end plan for moving `bap.basny.org` from the EC2 + Docker Compose stack to Fly.io. The app stays on SQLite; Litestream continues replicating to the existing Cloudflare R2 bucket (`basny-db-replica`).

## Goals & Non-Goals

**Goals**
- Eliminate AWS hosting cost (post-free-tier).
- Keep SQLite + the existing codebase — no rewrite.
- Preserve the Litestream → R2 replication that already works.
- Zero data loss, minimal downtime cutover (target < 5 min).
- Keep `bap.basny.org` so existing WebAuthn passkeys continue to work.

**Non-Goals**
- Switching DBs (D1, Turso, Postgres) — explicitly rejected for scope.
- Multi-region or HA — single machine is fine at this scale.
- Migrating R2 — already there, stays put.

## Architecture: Before vs. After

**Before** (EC2)
```
Route53 ─► EC2 (Docker Compose) ─► nginx (TLS via certbot) ─► app:4200
                                                               └─► /mnt/basny-data (EBS)
                                                                       └─► Litestream ─► R2
                                  + crontab: backups, health, ssmtp alerts
```

**After** (Fly)
```
DNS (basny.org) ─► fly-proxy (TLS auto) ─► app machine :4200
                                              └─► Fly volume /mnt/app-data
                                                      └─► Litestream ─► R2 (unchanged bucket)
```

Things that disappear: nginx container, certbot container, EC2 host, EBS volume, host crontabs, ssmtp, CDK stack, CloudWatch metric pushes.

## Pre-Flight Decisions (confirm before starting)

| Decision | Recommendation | Notes |
|---|---|---|
| Always-on vs. scale-to-zero | **Always-on**, `min_machines_running = 1` | Avoids cold starts; keeps Litestream continuous; in-process daily sweep keeps firing. ~$3–5/mo delta. |
| Machine size | `shared-cpu-1x` @ **1GB RAM** | Current limit is 768M; 512M is too tight. |
| Volume size | **1GB** | DB is small; ~$0.15/mo. Single volume = single writer (correct for SQLite). |
| Region | **`ewr`** (Newark) | Matches current US-East locality. |
| MCP servers (port 3001) | **Drop external exposure**, keep in-process for `fly ssh console` access only | If you need remote MCP, expose on Fly 6PN private network instead of internet. |
| Config delivery | **Single Fly secret** `CONFIG_JSON` materialized to `/app/src/config.json` at boot | One secret, no code changes. |
| Backups beyond Litestream | Litestream continuous + **weekly snapshot** to R2 via a Fly scheduled machine | Replaces hourly/daily/weekly/monthly cron tiers. |
| Uptime monitoring | **UptimeRobot** (or Better Uptime) hitting `/health` | Replaces CloudWatch metric cron. |

## Phase 0 — Local Prep (no deploy yet)

### 0.1 Add `fly.toml`

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
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

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
  memory = "1gb"
  cpus = 1
```

### 0.2 Patch `start.sh` to materialize config from secret

```sh
#!/bin/sh
set -e

# Materialize config.json from Fly secret (no-op locally if file already exists)
if [ -n "$CONFIG_JSON" ] && [ ! -f /app/src/config.json ]; then
  printf '%s' "$CONFIG_JSON" > /app/src/config.json
fi

# Litestream creds out of config.json (unchanged)
export LITESTREAM_ACCESS_KEY_ID=$(jq -r '.storage.s3AccessKeyId' /app/src/config.json)
export LITESTREAM_SECRET_ACCESS_KEY=$(jq -r '.storage.s3Secret' /app/src/config.json)

mkdir -p /mnt/app-data/database

if [ ! -f /mnt/app-data/database/database.db ]; then
  echo "No database found, attempting restore from Litestream replica..."
  if litestream restore -config /etc/litestream.yml /mnt/app-data/database/database.db; then
    echo "Restore complete."
  else
    echo "No replica found in R2, starting fresh."
  fi
fi

exec litestream replicate -config /etc/litestream.yml -exec "node src/index.js"
```

Diff vs. current: only the first `if` block is added; `set -e`; ensure DB dir exists.

### 0.3 Dockerfile tweaks

The existing Dockerfile already bakes Litestream and runs as `nodejs:1001`. Two small changes:

- **Drop** `COPY src/config.sample.json ./src/config.json` from the runner stage (it currently happens in the builder stage, which is fine — leave it). The runner won't have a real config until `start.sh` writes it, but `npm run build` only needs it for tsc, so this is OK as-is. **No change needed.**
- Confirm `start.sh` is copied into the runner stage. ✓ already is.

### 0.4 Wire up `/health` for Fly

Confirm `/health` returns 200 with no auth required. Already exists per Dockerfile HEALTHCHECK. ✓

### 0.5 Sanity-build locally

```bash
docker build -t basny-bap:local .
docker run --rm -p 4200:4200 \
  -e CONFIG_JSON="$(cat /path/to/config.production.json)" \
  -v $(pwd)/.fly-volume-test:/mnt/app-data \
  basny-bap:local
curl -f http://localhost:4200/health
```

## Phase 1 — Staging on Fly (no DNS yet)

### 1.1 Create app and volume

```bash
flyctl auth login
flyctl apps create basny-bap            # name must match fly.toml
flyctl volumes create basny_data --region ewr --size 1
```

### 1.2 Set the config secret

Production config currently lives at `/mnt/basny-data/app/config/config.production.json` on EC2. Pull a copy locally first.

```bash
ssh BAP 'sudo cat /mnt/basny-data/app/config/config.production.json' \
  > /tmp/config.production.json
flyctl secrets set CONFIG_JSON="$(cat /tmp/config.production.json)" --app basny-bap
shred -u /tmp/config.production.json   # don't leave creds on disk
```

### 1.3 First deploy

```bash
flyctl deploy --app basny-bap
flyctl logs --app basny-bap
```

Expected log sequence: "No database found" → "Restore complete." → app boots → health check passes.

### 1.4 Smoke test on the `*.fly.dev` hostname

```bash
curl -f https://basny-bap.fly.dev/health
flyctl ssh console --app basny-bap -C "sqlite3 /mnt/app-data/database/database.db 'SELECT COUNT(*) FROM members;'"
```

Open the staging URL, log in (passkeys won't work — wrong origin — use password), browse a few pages, post a test submission, verify Litestream is replicating:

```bash
flyctl ssh console --app basny-bap -C "litestream snapshots -config /etc/litestream.yml /mnt/app-data/database/database.db"
```

**Expected**: data is current (within Litestream replication lag) because the volume restored from the live R2 replica.

## Phase 2 — Cutover Dry Run

Goal: rehearse the real cutover end-to-end without touching DNS.

1. On EC2, take a manual `sqlite3 .backup` to confirm Litestream is current:
   ```bash
   ssh BAP 'sudo /opt/basny/scripts/backup-database.sh hourly'
   ```
2. On Fly, destroy the volume and recreate (simulates worst case):
   ```bash
   flyctl machines stop --app basny-bap <id>
   flyctl volumes destroy <volume-id>
   flyctl volumes create basny_data --region ewr --size 1
   flyctl machines start --app basny-bap <id>   # triggers fresh restore from R2
   ```
3. Verify row counts match production within Litestream's replication window.
4. Time the whole sequence — informs the cutover maintenance window.

## Phase 3 — Real Cutover

**Maintenance window: ~5 minutes.** Communicate to users beforehand.

### 3.1 Freeze writes on EC2

Easiest: stop the app container, leave nginx serving a maintenance page.

```bash
ssh BAP 'cd /opt/basny && docker compose -f docker-compose.prod.yml stop app'
```

### 3.2 Force final Litestream sync from EC2

Litestream replicates on a short interval, but be explicit:

```bash
ssh BAP 'docker compose -f /opt/basny/docker-compose.prod.yml exec -T app \
  litestream snapshots -config /etc/litestream.yml /mnt/app-data/database/database.db'
# Wait ~10s for replication, then:
ssh BAP 'docker compose -f /opt/basny/docker-compose.prod.yml stop app'
```

(If Litestream runs as the app's parent process, stopping the container flushes a final snapshot on graceful shutdown.)

### 3.3 Force Fly to restore the latest replica

```bash
flyctl ssh console --app basny-bap -C "rm /mnt/app-data/database/database.db /mnt/app-data/database/database.db-* 2>/dev/null; true"
flyctl machines restart --app basny-bap <id>
flyctl logs --app basny-bap   # watch for "Restore complete."
```

### 3.4 Verify row counts

```bash
flyctl ssh console --app basny-bap -C "sqlite3 /mnt/app-data/database/database.db \
  \"SELECT 'members='||COUNT(*) FROM members; SELECT 'subs='||COUNT(*) FROM submissions;\""
```

Compare to last EC2 numbers. Must match exactly.

### 3.5 Add the production hostname

```bash
flyctl certs add bap.basny.org --app basny-bap
flyctl certs show bap.basny.org --app basny-bap   # shows the DNS records to set
```

In the DNS provider for `basny.org`:
- Replace existing `bap` A/AAAA record with the Fly-provided `A` and `AAAA` records (or `CNAME` to `basny-bap.fly.dev` if the zone allows CNAME at that level — it's a subdomain, so yes).
- Drop TTL to 60s an hour beforehand if possible.

Wait for `flyctl certs show` to report the cert as Issued (~1–2 min after DNS resolves).

### 3.6 Smoke test on production hostname

```bash
curl -f https://bap.basny.org/health
```

Log in with a passkey (origin now matches → should work), submit a test record, confirm it shows up.

### 3.7 Keep EC2 up but quiet for 24–48h

Don't terminate yet. Stop the app + nginx but leave the box and EBS volume so rollback is one DNS flip away.

## Phase 4 — Post-Cutover Hardening

### 4.1 Replace cron-based backups

Litestream gives continuous PITR within its retention window. For point-in-time archival snapshots (the old hourly/daily/weekly/monthly tiers), create a separate Fly scheduled machine:

```bash
# fly-scheduled-backup/Dockerfile + script that runs:
#   flyctl ssh sftp shell ... OR connects to R2 and snapshots
# Easiest: a tiny image that runs `litestream snapshots` weekly
```

Recommendation: start with **Litestream-only + R2 versioning** on the `basny-db-replica` bucket (enable in Cloudflare dashboard, set 30-day retention). Skip the cron-snapshot machine until you have a reason to need it.

### 4.2 Uptime monitoring

Sign up for UptimeRobot (free tier: 50 monitors, 5-min interval). Monitor `https://bap.basny.org/health`. Replaces the CloudWatch metric cron and the ssmtp alert plumbing.

### 4.3 Log retention

Fly retains logs in their UI for ~3 days. If you want long-term, ship to a free tier on Axiom or BetterStack via a log shipper. Optional — skip unless audit need arises.

### 4.4 Update operational docs

- Rewrite `infrastructure/sync-db-from-production.sh` to pull from R2 directly (no SSH involved):
  ```bash
  litestream restore -config litestream.yml -o db/database.db
  ```
  This is simpler than the current SSH/scp dance and works from any dev machine.
- Update `CLAUDE.md` ops references to point at `flyctl` commands.
- Archive `infrastructure/CDK_SAFETY.md`, `TAILSCALE_MIGRATION.md`, `SENDMAIL_CONFIGURATION.md`, `CRONTAB.md` — all moot.

### 4.5 Delete `infrastructure/` CDK code

After confirming nothing imports from it, delete the CDK directory. Keep `sync-db-from-production.sh` (rewritten) and operational docs.

## Phase 5 — Decommission AWS

After 7 days of stable Fly operation:

1. Snapshot the EBS volume one last time and download to local cold storage.
2. Terminate EC2 instance.
3. Delete EBS volume.
4. Delete Route53 hosted zone if `basny.org` is fully migrated (check first — other subdomains may live there).
5. Delete CloudWatch alarms / metrics / log groups specific to BAP.
6. Delete IAM roles / instance profiles that only EC2 used.
7. Close any unused S3 buckets (R2 is separate — leave alone).
8. **Leave the AWS account open** at least one billing cycle to confirm $0 charges before closing.

## Rollback Plan

Trigger conditions: data integrity issue discovered post-cutover, performance regression, auth/passkey breakage.

**Within the maintenance window** (DNS not yet propagated to all clients):
1. Restart EC2 app container: `ssh BAP 'cd /opt/basny && docker compose -f docker-compose.prod.yml start app'`
2. Revert DNS `bap` record to old EC2 IP, TTL 60s.
3. On Fly, `flyctl scale count 0` to stop accepting traffic.
4. Investigate Fly issue offline.

**After cutover, if writes happened on Fly**:
1. Stop Fly: `flyctl scale count 0`.
2. Restore latest Fly Litestream snapshot to EC2 volume (use `litestream restore` on EC2).
3. Restart EC2 app.
4. Flip DNS back.

**Forward-only rule**: once writes occur on Fly, never restart EC2 without restoring Fly's data first — diverged DB state will lose submissions.

## Cost Estimate (post-migration)

| Item | Monthly |
|---|---|
| Fly `shared-cpu-1x@1GB`, always on | ~$3.20 |
| Fly volume 1GB | ~$0.15 |
| Fly bandwidth (modest) | ~$0–1 |
| R2 storage (existing) | already paid |
| UptimeRobot free tier | $0 |
| **Total** | **~$4–5/mo** |

vs. EC2 t3.small + EBS + bandwidth post-free-tier: ~$15–25/mo.

## Open Questions

1. Does `basny.org` zone live in Route53 or elsewhere? Decides Phase 5 step 4.
2. Are there other services on the EC2 box (mail, MCP HTTP, anything besides the BAP app)? If yes, they need their own migration path before the box can be terminated.
3. Is the Cloudflare R2 account access shared, or single-owner? Confirm secret rotation plan if shared.
4. Confirm WebAuthn `rpID` in production config is `bap.basny.org` (not `basny.org` or a wildcard) — must match exactly post-cutover.

## Appendix: Quick-Reference Commands

```bash
# Tail logs
flyctl logs --app basny-bap

# Shell into machine
flyctl ssh console --app basny-bap

# Inspect DB
flyctl ssh console --app basny-bap -C "sqlite3 /mnt/app-data/database/database.db"

# Force redeploy
flyctl deploy --app basny-bap

# Rotate config secret
flyctl secrets set CONFIG_JSON="$(cat config.production.json)" --app basny-bap

# Scale to zero (emergency stop)
flyctl scale count 0 --app basny-bap

# Volume snapshot (Fly-side, separate from Litestream)
flyctl volumes snapshots create <volume-id>
```
