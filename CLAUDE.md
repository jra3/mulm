# CLAUDE.md - Project Context for AI Assistants

## Project Overview
Mulm is a Breeder Awards Program (BAP) management platform for aquarium societies. It tracks breeding achievements, manages member submissions, and handles species data.

## Tech Stack
- **Backend**: Node.js with Express.js and TypeScript
- **Database**: SQLite with migrations
- **Frontend**: Pug templates with HTMX for interactivity
- **Styling**: Tailwind CSS with PostCSS
- **Infrastructure**: Docker Compose, Cloudflare tunnel
- **Testing**: Jest with ts-jest

## Key Architectural Decisions

### Database Transactions
We use a `withTransaction` wrapper pattern for database operations. The try/catch around ROLLBACK is intentional - it's the standard pattern for the sqlite3 package which doesn't expose transaction state checking.

### Logging
- Custom logger utility in `src/utils/logger.ts` that respects NODE_ENV
- Automatically silences logs during tests (NODE_ENV=test)
- Use `logger.error()`, `logger.warn()`, `logger.info()` instead of console.*

### Form Validation
- Zod schemas for all forms (see `src/forms/`)
- Server-side validation with detailed error messages
- Form state preservation on validation errors

## Development Commands
```bash
npm run dev        # Start development server with hot reload
npm run build      # Build TypeScript and assets
npm test           # Run Jest tests
npm run lint       # Run ESLint
npm run lint:fix   # Fix ESLint issues
num run script     # runs something with ts-node
```

## Common Patterns

### API Routes
Routes are organized by domain in `src/routes/`:
- Use `MulmRequest` type for typed sessions
- Always validate user permissions
- Return appropriate HTTP status codes

### Database Queries
- Use prepared statements for all queries
- Always finalize() prepared statements
- Use the query helper from conn.ts for simple SELECT queries
- Use withTransaction wrapper for transactions

### Testing
- Tests use temporary SQLite databases
- Each test gets a fresh database with migrations
- Use `overrideConnection()` to inject test database

## Scripts
These live alongside the src directory because they have incompatible tsconfig
settings. All scripts meant to be run from the CLI should be put in scripts/ and
tun with ts-node

## Important Files
- `src/index.ts` - Main application entry point
- `src/db/conn.ts` - Database connection management
- `src/sessions.ts` - Session middleware and types
- `src/forms/` - Zod schemas for form validation
- `db/migrations/` - SQL migration files

## Current Work & Known Issues
- All should be in github

## Security Considerations
- Never expose config secrets in logs
- Always validate file uploads server-side
- Implement rate limiting on sensitive endpoints

## Deployment
- Running in docker on a single linux maching via docker compose
- Database is a sqlite file on disk, periodically backed up
- Cloudflare tunnel for secure access
- Environment-specific configs in config.json

## Contributing Guidelines
1. Follow existing code patterns
2. Don't add comments when the code is self-explanatory
3. Add tests for new features
4. Update this file with significant changes
5. Use conventional commit messages
6. Run linter and unit tests before committing

## Pug Template Guidelines
**CRITICAL**: Avoid Tailwind class chain errors in Pug templates

### Common Pitfalls to Avoid:
- ❌ **Mixed quotes**: `div(class="max-w-4xl" id='container')` 
- ❌ **Long single lines**: Tailwind utility chains over 140 characters
- ❌ **Single quotes**: Always use double quotes for attributes
- ❌ **SVG viewBox**: `viewBox` must be lowercase `viewbox` in Pug
- ❌ **Multiple blank lines**: Remove extra whitespace

### Best Practices:
- ✅ **Use double quotes**: `div(class="max-w-4xl mx-auto")`
- ✅ **Break long class chains**:
  ```pug
  div(
    class="bg-gradient-to-r from-yellow-50 to-amber-50" +
          " rounded-lg shadow-lg p-6"
  )
  ```
- ✅ **Create component classes** for repeated patterns:
  ```css
  .approval-panel {
    @apply bg-gray-600 p-4 shadow-md mt-6;
  }
  ```
- ✅ **Use Pug class chains** for simple utilities: `div.flex.gap-4.items-center`
- ✅ **Use class attributes** for complex responsive utilities

### Style Guidelines:
- Follow the best practices outlined above for consistent template structure
- Use double quotes for attributes and break long class chains for readability
