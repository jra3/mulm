# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Mulm is a Breeder Awards Program (BAP) management platform for aquarium societies. It tracks breeding achievements, manages member submissions, and handles species data.

**Production URL**: https://bap.basny.org

## Tech Stack

- **Backend**: Node.js with Express.js and TypeScript
- **Database**: SQLite with migrations
- **Frontend**: Pug templates with HTMX for interactivity
- **Styling**: Tailwind CSS with PostCSS
- **Infrastructure**: AWS EC2 with Docker Compose, nginx reverse proxy, Let's Encrypt SSL
- **Testing**: Node.js native test runner with tsx, Playwright for E2E
- **Storage**: Cloudflare R2 for image storage

## Quick Start

```bash
npm install          # Install dependencies
npm run dev          # Start development server with hot reload
npm test             # Run tests
npm run lint         # Run linter
npm run build        # Build for production
```

## Development Commands

```bash
npm run dev        # Start development server (Nodemon + PostCSS watch)
npm run build      # Build TypeScript and PostCSS assets
npm test           # Run Jest tests
npm run lint       # Run ESLint
npm run lint:fix   # Fix ESLint issues
npm run script     # Run scripts with ts-node (e.g., npm run script scripts/example.ts)
npm start          # Start production server (requires build first)
```

### Testing Commands

```bash
# Unit/Integration tests (Node.js native test runner)
npm test                      # Run all tests
npm test -- path/to/test.ts   # Run specific test file
npm test -- --watch           # Run tests in watch mode

# E2E tests (Playwright)
npm run test:e2e              # Run E2E tests
npm run test:e2e:headed       # Run E2E tests with browser UI
npm run test:e2e:debug        # Debug E2E tests
npm run test:e2e:ui           # Open Playwright UI mode
npm run test:e2e:report       # View test report
```

## Documentation by Area

This repository uses directory-specific README files for detailed documentation:

- **[src/README.md](src/README.md)** - Backend architecture, code patterns, session management
- **[src/db/README.md](src/db/README.md)** - Database patterns, queries, transactions, migrations
- **[src/routes/README.md](src/routes/README.md)** - Routing conventions, RESTful patterns, API reference
- **[src/views/README.md](src/views/README.md)** - Pug templates, Tailwind, design system, date formatting
- **[infrastructure/README.md](infrastructure/README.md)** - Production deployment, monitoring, operations, recovery
- **[nginx/README.md](nginx/README.md)** - Nginx configuration, SSL, rate limiting, security

## Development Workflow

### Branch Protection

The `main` branch is protected and requires:
- ✅ All CI checks must pass (`test` + `e2e-tests`)
- ✅ Branch must be up-to-date with main
- ❌ No force pushes allowed
- ❌ No direct deletion allowed

**Recommended workflow:**
1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make changes and commit with descriptive messages
3. Push branch: `git push -u origin feature/my-feature`
4. Open a pull request using the PR template
5. Ensure CI passes before merging
6. Use squash or merge commit (no force push to main)

**For quick fixes** (admins only):
- Direct commits to main are allowed for admins but CI must still pass
- Use with caution - prefer PRs for visibility and review

### GitHub Governance as Code

Repository settings are version-controlled in `.github/`:

- **Labels**: `.github/labels.yml` - Auto-synced via workflow
- **Issue Templates**: `.github/ISSUE_TEMPLATE/` - Bug reports and feature requests
- **PR Template**: `.github/PULL_REQUEST_TEMPLATE.md` - Checklist for all PRs
- **Branch Protection**: `.github/branch-protection.json` - Main branch rules (reapply with `gh api`)
- **Security Policy**: `SECURITY.md` - Vulnerability reporting guidelines

To modify labels, edit `.github/labels.yml` and push - they sync automatically.

## Critical Rules

### Code Quality

- ❌ **NEVER use dynamic imports** - ALWAYS use static imports at the top of files
  - ❌ BAD: `const { foo } = await import("@/module");`
  - ✅ GOOD: `import { foo } from "@/module";` at top of file
  - Reason: Breaks tree shaking, type checking, and code analysis
- ❌ **Never use `require()`** in TypeScript - Use ES6 imports
- ✅ **Static imports only** - All imports must be at the top of the file
- ✅ **HTMX-first architecture** - Prefer HTMX attributes over custom JavaScript for form interactions
- ✅ **Validate with Zod schemas** - Always validate request bodies with zod, never use `as` type assertions
- ✅ **Function naming clarity** - Functions that mutate should have names like `ensure`, `create`, `update`, not just `get`
- ⚠️ **Avoid `&&` in Pug attributes** - Use ternary operators or server-side variables to prevent HTML encoding issues
- ⚠️ **AdminRouter routes** - Don't check `viewer.is_admin` in individual handlers; `requireAdmin` middleware handles it

### Pre-commit Hooks

The repository uses [husky](https://github.com/typicode/husky) and [lint-staged](https://github.com/okonet/lint-staged) to automatically lint staged files before commits:

- ESLint runs on all staged `.ts` files in `src/` and `scripts/`
- Auto-fixes are applied when possible
- Commits are blocked if lint errors remain

To bypass the pre-commit hook (not recommended):
```bash
git commit --no-verify
```

### Scripts Directory

Scripts use separate tsconfig for CLI compatibility. Run with:

```bash
npm run script scripts/scriptname.ts
```

### Configuration

- **Development**: `src/config.json` (git-ignored)
- **Production**: `/mnt/basny-data/app/config/config.production.json`
- **Environment**: `NODE_ENV` controls behavior (test, development, production)

### Logging

Use the custom logger from `src/utils/logger.ts`:

```typescript
import { logger } from '@/utils/logger';
logger.error('message', error);
logger.warn('message');
logger.info('message');
```

Logger respects NODE_ENV and is automatically silenced during tests.

## Production Info

**Production URL**: https://bap.basny.org

For deployment procedures, infrastructure details, and operations:
- See **[infrastructure/README.md](infrastructure/README.md)** for complete documentation
- See **[GitHub Wiki](https://github.com/jra3/mulm/wiki)** for comprehensive guides

Quick reference:
- SSH: `ssh BAP`
- Deploy: `ssh BAP "cd /opt/basny && git pull && sudo docker-compose -f docker-compose.prod.yml pull && sudo docker-compose -f docker-compose.prod.yml up -d"`
- Logs: `ssh BAP "sudo docker logs basny-app --tail 100 -f"`
- Health: `curl https://bap.basny.org/health`
