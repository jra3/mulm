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

### Matt Pocock's engineering skills (mattpocock/skills v1.1.0, MIT)

Installed as editable files under `.claude/skills/` (full v1.1.0 set — see `.claude/skills/MATTPOCOCK-SKILLS.md` for provenance). Start with **`/ask-matt`**, the router that points you at the right skill/flow (grill → spec → tickets → implement; plus `research`, `code-review`, `diagnosing-bugs`, `domain-modeling`, `wayfinder`, `tdd`, `triage`, etc.). Run **`/setup-matt-pocock-skills`** only to re-configure the tracker/labels/doc layout (already configured below).

## Agent skills

### Issue tracker

GitHub Issues on `jra3/mulm` (via `gh`); external PRs are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles mapped 1:1 (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), alongside the existing `GITHUB_LABELS.md` scheme. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root, ADRs under `docs/adr/`. See `docs/agents/domain.md`.
