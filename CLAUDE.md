# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Mulm is a Breeder Awards Program (BAP) management platform for aquarium societies. It tracks breeding achievements, manages member submissions, and handles species data.

**Production URL**: https://bap.basny.org

## Tech Stack
- **Backend**: Node.js with Express.js and TypeScript
- **Database**: SQLite with migrations
- **Frontend**: Pug templates with HTMX for interactivity
- **Styling**: Tailwind CSS with PostCSS
- **Infrastructure**: Docker Compose, Cloudflare tunnel
- **Testing**: Jest with ts-jest

## Development Commands
```bash
npm run dev        # Start development server with hot reload (Nodemon + PostCSS watch)
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

## Architecture

### Database Layer
- **Dual connection pattern**: Separate read-only and write connections (`src/db/conn.ts`)
- **Transaction wrapper**: `withTransaction()` function for atomic operations
  - The try/catch around ROLLBACK is intentional - sqlite3 package doesn't expose transaction state
- **Migration system**: Auto-runs on startup from `db/migrations/`
- **Query helpers**: `query()` for SELECT, `insertOne()`, `updateOne()` for mutations

### Session Management
- Cookie-based sessions stored in SQLite
- `MulmRequest` type extends Express Request with typed `viewer` property
- Session middleware automatically populates viewer from database

### Route Organization
Routes are domain-organized in `src/routes/`:
- **Public routes**: species, standings, typeahead
- **Auth routes**: account, auth (including OAuth)
- **Member routes**: member, submission, tank
- **Admin routes**: adminRouter with approval/witness queues

### Form Validation
- Zod schemas define all form structures (`src/forms/`)
- Server-side validation with field-level error messages
- Form state preservation on validation errors

### Testing Strategy
- Each test gets isolated in-memory SQLite database
- Migrations run automatically for each test database
- `overrideConnection()` injects test database
- Helper utilities in `src/__tests__/testDbHelper.helper.ts`

## Key Patterns

### Database Operations
```typescript
// Simple queries
const results = await query<Type>('SELECT * FROM table WHERE id = ?', [id]);

// Transactions
await withTransaction(async (db) => {
  // Multiple operations atomically
  await db.run('INSERT ...');
  await db.run('UPDATE ...');
});

// Always finalize prepared statements
const stmt = await db.prepare('...');
try {
  await stmt.run(...);
} finally {
  await stmt.finalize();
}
```

### Request Handling
```typescript
// Typed request with viewer
router.get('/path', async (req: MulmRequest, res) => {
  const { viewer } = req; // Typed viewer or undefined
  if (!viewer) return res.redirect('/signin');
  // ...
});
```

## Scripts Directory
Scripts use separate tsconfig for CLI compatibility. Run with:
```bash
npm run script scripts/scriptname.ts
```

## Pug Template Guidelines
**CRITICAL**: Avoid Tailwind class chain errors

### Common Pitfalls
- ❌ Mixed quotes: `div(class="max-w-4xl" id='container')`
- ❌ Long single lines: Tailwind chains over 140 characters
- ❌ SVG viewBox: Must be lowercase `viewbox` in Pug

### Best Practices
- ✅ Use double quotes: `div(class="max-w-4xl mx-auto")`
- ✅ Break long class chains:
  ```pug
  div(
    class="bg-gradient-to-r from-yellow-50 to-amber-50" +
          " rounded-lg shadow-lg p-6"
  )
  ```
- ✅ Simple utilities: `div.flex.gap-4.items-center`

## Logging
- Custom logger in `src/utils/logger.ts` respects NODE_ENV
- Automatically silenced during tests (NODE_ENV=test)
- Use `logger.error()`, `logger.warn()`, `logger.info()` instead of console.*