# BAP Operations & Deployment Skill

Use this skill for production operations, deployment, and infrastructure tasks.

## Production Environment

- **URL**: https://bap.basny.org
- **Server**: AWS EC2
- **Stack**: Docker Compose + nginx reverse proxy + Let's Encrypt SSL
- **Docs**: See `infrastructure/README.md` and [GitHub Wiki](https://github.com/jra3/mulm/wiki)

## Quick Commands

```bash
# SSH to production
ssh BAP

# Deploy latest changes
ssh BAP "cd /opt/basny && git pull && sudo docker-compose -f docker-compose.prod.yml pull && sudo docker-compose -f docker-compose.prod.yml up -d"

# View logs
ssh BAP "sudo docker logs basny-app --tail 100 -f"

# Health check
curl https://bap.basny.org/health
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
| Production | `/mnt/basny-data/app/config/config.production.json` |
| Test | Uses in-memory SQLite |

`NODE_ENV` controls behavior: `test`, `development`, `production`

## Infrastructure Documentation

- `infrastructure/README.md` - Full deployment docs, monitoring, recovery
- `nginx/README.md` - Nginx config, SSL, rate limiting, security
- `src/db/README.md` - Database patterns, migrations
