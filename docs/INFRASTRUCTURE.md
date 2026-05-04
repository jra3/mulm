# Infrastructure

Operational reference for the BAP platform's runtime environment.

## Topology

```
                   bap.basny.org
                         │
                         ▼
                  ┌─────────────┐
                  │  fly-proxy  │  TLS, anycast (auto-managed by Fly)
                  └──────┬──────┘
                         │
                  ┌──────▼──────┐
                  │ basny-bap   │  Production app (Fly machine, ewr)
                  │   :4200     │  shared-cpu-1x @ 2GB, scale-to-zero
                  └──┬───────┬──┘
                     │       │
        Fly volume ◄─┤       ├─► Litestream → Cloudflare R2
        /mnt/app-data│       │   bucket: basny-db-replica
        SQLite at    │       │   continuous WAL replication
        /database/   │       │
                     │       └─► Cloudflare R2
                     │           bucket: basny-bap-data
                     │           image uploads (sharp + S3 SDK)
                     │
                     └── (staging restores read-only from same
                          R2 generation; never writes back)
```

## Fly Apps

| App | Role | URL | Volume |
|---|---|---|---|
| `basny-bap` | production | https://bap.basny.org | `basny_data` |
| `basny-bap-staging` | refreshable preview of prod data | https://basny-bap-staging.fly.dev | `basny_staging_data` |

Both apps:
- Region: `ewr` (Newark)
- Machine: `shared-cpu-1x` @ 2GB RAM
- Scale-to-zero (`auto_stop_machines = "stop"`, `min_machines_running = 0`)
- Volume mounted at `/mnt/app-data` (1GB, encrypted, scheduled snapshots)
- Health endpoint: `GET /health`

## Configuration

The full app config (DB path, OAuth, SMTP, R2 credentials, WebAuthn, etc.) is delivered as a single Fly secret named `CONFIG_JSON`. `start.sh` materializes it to `/app/src/config.json` on every boot.

| App | `CONFIG_JSON` overrides vs. real prod config |
|---|---|
| `basny-bap` | none — uses real config |
| `basny-bap-staging` | `server.domain`, `webauthn.rpID`, `webauthn.origin` → `basny-bap-staging.fly.dev`; `email.disableEmails = true` |

Rotate with `flyctl secrets set CONFIG_JSON="$(cat config.production.json)" --app <app>`.

## Storage

| What | Where |
|---|---|
| SQLite database | Fly volume `/mnt/app-data/database/database.db` |
| WAL replica | Cloudflare R2 bucket `basny-db-replica` (continuous via Litestream) |
| Image uploads | Cloudflare R2 bucket `basny-bap-data` (S3 SDK) |
| Litestream config | `litestream.yml` — bucket name + R2 endpoint hardcoded; credentials from `LITESTREAM_*` env, derived from `CONFIG_JSON.storage.s3*` in `start.sh` |

## Litestream Behavior by Environment

| | Production | Staging |
|---|---|---|
| `STAGING` env var | unset | `STAGING=1` |
| On boot, if local DB missing | `litestream restore` from R2 | same |
| While running | `litestream replicate` (continuous WAL → R2) | **disabled** — runs `node` directly |

The staging mode prevents staging from ever writing to R2, so it cannot pollute prod's generation history.

## Deploy

```bash
# Production
flyctl deploy --app basny-bap

# Staging
flyctl deploy --config fly.staging.toml --app basny-bap-staging
```

Both build the same `Dockerfile`. Differences come from `fly.toml` vs. `fly.staging.toml` and from the `CONFIG_JSON` secret.

## Refresh Staging from Prod

```bash
MACHINE=$(flyctl machines list --app basny-bap-staging --json | jq -r '.[0].id')
flyctl ssh console --app basny-bap-staging \
  -C "rm -f /mnt/app-data/database/database.db /mnt/app-data/database/database.db-shm /mnt/app-data/database/database.db-wal"
flyctl machine restart "$MACHINE" --app basny-bap-staging
```

Next boot, `start.sh` finds no DB → `litestream restore` from R2 → staging now reflects prod's current state (within Litestream replication lag, ~seconds).

## Common Ops

```bash
# Tail logs
flyctl logs --app basny-bap

# Open a shell inside the running machine
flyctl ssh console --app basny-bap

# Inspect DB
flyctl ssh console --app basny-bap -C "sqlite3 /mnt/app-data/database/database.db"

# Inspect Litestream replica state
flyctl ssh console --app basny-bap \
  -C "litestream snapshots -config /etc/litestream.yml /mnt/app-data/database/database.db"

# Restore DB locally for development (read-only pull from R2)
litestream restore -config litestream.yml -o db/database.db
```

## Access

- **Fly**: `flyctl auth login` (account: `nop@porcnick.com`, org `personal`).
- **EC2 box** (legacy, until Phase 5 decommission): SSH alias `BAP` → `ec2-user@ip-10-0-0-218` over Tailscale.
- **R2**: credentials live in `config.production.json` under `storage.s3*`; same key used for Litestream and image uploads.
- **DNS**: registrar (not Route53/Cloudflare); `bap` record is the cutover knob.

## Cost (estimated)

- Fly volume 1GB × 2 (prod + staging): ~$0.30/mo
- Stopped-machine rootfs × 2: ~$0.30–0.60/mo
- Compute (scale-to-zero, light traffic): ~$2–4/mo
- Cloudflare R2 storage + egress: well under the 10GB free tier
- **Total: ~$3–5/mo**

## Related Docs

- [`DEPLOY.md`](./DEPLOY.md) — day-to-day bugfix-to-prod runbook
- [`FLY_MIGRATION.md`](./FLY_MIGRATION.md) — full migration playbook (phases, rollback, prose rationale)
- [`FLY_MIGRATION_EXECUTION.md`](./FLY_MIGRATION_EXECUTION.md) — locked decision record + progress log for the EC2→Fly cutover
- [`../scripts/cutover.sh`](../scripts/cutover.sh) — interactive Phase 3 cutover runbook
