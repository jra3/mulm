# CLAUDE.md

## Project Overview

Mulm is a Breeder Awards Program (BAP) management platform for aquarium societies. It tracks breeding achievements, manages member submissions, and handles species data.

**Production URL**: https://bap.basny.org

## Tech Stack

- **Backend**: Node.js with Express.js and TypeScript
- **Database**: SQLite with migrations
- **Frontend**: Pug templates with HTMX for interactivity
- **Styling**: Tailwind CSS with PostCSS
- **Testing**: Node.js native test runner, Playwright for E2E
- **Storage**: Cloudflare R2 for image storage

## Quick Start

```bash
npm install          # Install dependencies
npm run dev          # Start development server with hot reload
npm test             # Run tests
npm run lint         # Run linter
```

## Critical Rules

### Code Quality

- **NEVER use dynamic imports** - Always use static imports at the top of files
  - BAD: `const { foo } = await import("@/module");`
  - GOOD: `import { foo } from "@/module";`
- **Never use `require()`** in TypeScript - Use ES6 imports
- **HTMX-first architecture** - Prefer HTMX attributes over custom JavaScript
- **Validate with Zod schemas** - Never use `as` type assertions for request bodies
- **Function naming clarity** - Mutating functions: `ensure`, `create`, `update`, not `get`
- **Avoid `&&` in Pug attributes** - Use ternary operators to prevent HTML encoding issues
- **AdminRouter routes** - Don't check `viewer.is_admin`; `requireAdmin` middleware handles it

### Logging

```typescript
import { logger } from '@/utils/logger';
logger.error('message', error);
logger.warn('message');
logger.info('message');
```

### Scripts

```bash
npm run script scripts/scriptname.ts
```

## Issue Tracking

This project uses **GitHub Issues only**. Linear is not used.

- GitHub Project: [CARES Program Tracking](https://github.com/users/jra3/projects/2)
- Issues: https://github.com/jra3/mulm/issues

## Skills

- **`/frontend-design`** - UI patterns, Pug mixins, Tailwind conventions, HTMX patterns
- **`/ops`** - Deployment, testing commands, branch protection, infrastructure
