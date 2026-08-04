# BAP Operations & Deployment Skill

Use this skill for production operations, deployment, and infrastructure tasks.

## Production Environment

- **Host**: Fly.io — app `basny-bap` (staging: `basny-bap-staging`), region `ewr`
- **URL**: https://bap.basny.org (staging: https://basny-bap-staging.fly.dev)
- **Stack**: Dockerfile-based Fly Machine; TLS/ingress handled by fly-proxy
- **Database**: SQLite on the `basny_data` volume at `/mnt/app-data/database/database.db`
- **Backups**: Litestream continuous replication to Cloudflare R2 (`basny-db-replica`)
- **Docs**: See `docs/DEPLOY.md` (runbook) and `docs/INFRASTRUCTURE.md` (topology)

## Quick Commands

```bash
# Deploy to staging first, then prod (see docs/DEPLOY.md for the full flow)
flyctl deploy --config fly.staging.toml --app basny-bap-staging
flyctl deploy --app basny-bap

# Status / health
flyctl status --app basny-bap
curl -sf https://bap.basny.org/health      # 200 = good

# Logs (tail)
flyctl logs --app basny-bap

# SSH into the running machine
flyctl ssh console --app basny-bap

# Pull prod DB into local dev (Litestream restore from R2)
./infrastructure/sync-db-from-production.sh
```

## Staging: Deploy, Refresh Data, and Test Accounts

Staging (`basny-bap-staging`, https://basny-bap-staging.fly.dev) restores a
read-only copy of prod data on boot and never replicates back (`STAGING=1`), so
it's safe to break. Scale-to-zero: HTTP requests auto-wake it; `flyctl ssh` does not.

```bash
# 1. Deploy your branch/main to staging
flyctl deploy --config fly.staging.toml --app basny-bap-staging

# 2. (optional) Refresh prod data. NOTE: this WIPES seeded test users.
MACHINE=$(flyctl machines list --app basny-bap-staging --json | jq -r '.[0].id')
flyctl ssh console --app basny-bap-staging \
  -C "rm -f /mnt/app-data/database/database.db /mnt/app-data/database/database.db-shm /mnt/app-data/database/database.db-wal"
flyctl machine restart "$MACHINE" --app basny-bap-staging   # start.sh restores from prod R2

# 3. (Re)create test logins — idempotent, run after every data refresh
./scripts/seed-staging-users.sh
```

**Test accounts** (created by the seed script; same creds as `e2e/helpers/testData.ts`):

| Role | Email | Password |
|------|-------|----------|
| admin | `baptest+admin@porcnick.com` | `AdminPassword123!` |
| non-admin | `baptest+e2e@porcnick.com` | `TestPassword123!` |

The seed script refuses to run against any machine without `STAGING=1` (prod safety),
starts the scale-to-zero VM, and upserts via `ON CONFLICT`. Passkeys don't work on
staging (wrong origin) — log in with a password.

**Verify a login without a browser** (`POST /auth/login`, fields `email` + `password`):

```bash
HOST=https://basny-bap-staging.fly.dev
curl -s -D - -o /dev/null -H "Origin: $HOST" \
  --data-urlencode "email=baptest+admin@porcnick.com" \
  --data-urlencode "password=AdminPassword123!" \
  "$HOST/auth/login" | grep -iE '^HTTP/|^hx-redirect:|^set-cookie:'
# Success = HX-Redirect: / + a session_id cookie. Failure = 200 body "Incorrect email or password".
```

## Branch Protection

The `main` branch is protected:
- All CI checks must pass (`test` + `e2e-tests`)
- Branch must be up-to-date with main
- No force pushes allowed
- No direct deletion allowed

**Workflow:**
1. Create feature branch: `git checkout -b feature/my-feature`
2. Push and open PR: `git push -u origin feature/my-feature`
3. Ensure CI passes before merging
4. Use squash or merge commit

## Testing Commands

```bash
# Unit/Integration tests
npm test                      # Run all tests
npm test -- path/to/test.ts   # Run specific test file
npm test -- --watch           # Watch mode

# E2E tests (Playwright)
npm run test:e2e              # Run E2E tests
npm run test:e2e:headed       # With browser UI
npm run test:e2e:debug        # Debug mode
npm run test:e2e:ui           # Playwright UI mode
npm run test:e2e:report       # View report
```

## Pre-commit Hooks

Husky + lint-staged run ESLint on staged `.ts` files:
- Auto-fixes applied when possible
- Commits blocked if lint errors remain
- Bypass (not recommended): `git commit --no-verify`

## GitHub Governance

Repository settings in `.github/`:
- **Labels**: `.github/labels.yml` - Auto-synced via workflow
- **Issue Templates**: `.github/ISSUE_TEMPLATE/`
- **PR Template**: `.github/PULL_REQUEST_TEMPLATE.md`
- **Branch Protection**: `.github/branch-protection.json`

## Configuration

| Environment | Config Location |
|-------------|-----------------|
| Development | `src/config.json` (git-ignored) |
| Production | Fly secret `CONFIG_JSON`, written to `src/config.json` on boot by `start.sh` |
| Test | Uses in-memory SQLite |

`NODE_ENV` controls behavior: `test`, `development`, `production`

## Infrastructure Documentation

- `docs/DEPLOY.md` - Day-to-day deploy runbook (staging → prod)
- `docs/INFRASTRUCTURE.md` - Topology, costs, Fly/R2 reference
- `src/db/README.md` - Database patterns, migrations
