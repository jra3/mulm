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
- **Testing**: Jest with ts-jest
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
npm test                      # Run all tests
npm test -- path/to/test.ts   # Run specific test file
npm test -- --watch           # Run tests in watch mode
```

## Documentation by Area

This repository uses directory-specific README files for detailed documentation:

- **[src/README.md](src/README.md)** - Backend architecture, code patterns, session management
- **[src/db/README.md](src/db/README.md)** - Database patterns, queries, transactions, migrations
- **[src/routes/README.md](src/routes/README.md)** - Routing conventions, RESTful patterns, API reference
- **[src/views/README.md](src/views/README.md)** - Pug templates, Tailwind, design system, date formatting
- **[infrastructure/README.md](infrastructure/README.md)** - Production deployment, monitoring, operations, recovery
- **[nginx/README.md](nginx/README.md)** - Nginx configuration, SSL, rate limiting, security

## Critical Rules

### Code Quality

- ❌ **Never use dynamic imports** - Always use static imports at the top of files
- ❌ **Never use `require()`** in TypeScript - Use ES6 imports
- ✅ **Static imports only** - Enables tree shaking, type checking, and better performance
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
