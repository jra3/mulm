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
- **Infrastructure**: AWS EC2 with Docker Compose, nginx reverse proxy, Let's Encrypt SSL
- **Testing**: Jest with ts-jest
- **Storage**: Cloudflare R2 for image storage

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
- ❌ Dot notation with colons: `div.hover:bg-blue-500` breaks - colons in Tailwind modifiers (hover:, md:, focus:) are incompatible with Pug's dot syntax

### Best Practices
- ✅ Use double quotes: `div(class="max-w-4xl mx-auto")`
- ✅ Break long class chains:
  ```pug
  div(
    class="bg-gradient-to-r from-yellow-50 to-amber-50" +
          " rounded-lg shadow-lg p-6"
  )
  ```
- ✅ Simple utilities only with dot notation: `div.flex.gap-4.items-center`
- ✅ Use class attribute for modifiers: `div(class="hover:bg-blue-500 md:flex focus:outline-none")`

## Logging
- Custom logger in `src/utils/logger.ts` respects NODE_ENV
- Automatically silenced during tests (NODE_ENV=test)
- Use `logger.error()`, `logger.warn()`, `logger.info()` instead of console.*

## Production Deployment

### Infrastructure
- **Platform**: AWS EC2 (t3.micro) with 20GB EBS volume
- **IP**: 54.87.111.167 (Elastic IP)
- **SSH**: Connect via `ssh BAP` (configured in ~/.ssh/config)
- **Location**: `/opt/basny` (application code), `/mnt/basny-data` (persistent data)
- **CDK Stack**: Infrastructure defined in `infrastructure/` directory
  - Deploy: `cd infrastructure && npm run cdk deploy`
  - SSH key stored in AWS Systems Manager Parameter Store

### Docker Containers
Production runs three containers via `docker-compose.prod.yml`:
- **basny-app**: Node.js application on port 4200 (internal)
- **basny-nginx**: Reverse proxy handling HTTP/HTTPS traffic
- **basny-certbot**: Automatic SSL certificate renewal

### Data Persistence
All persistent data lives on EBS volume at `/mnt/basny-data/`:
```
/mnt/basny-data/
├── app/
│   ├── config/config.production.json  # Production config
│   └── database/database.db           # SQLite database
└── nginx/
    ├── certs/                         # SSL certificates
    ├── logs/                          # Access/error logs
    └── webroot/                       # ACME challenges
```

### Deployment Commands
```bash
# Deploy latest code
ssh BAP "cd /opt/basny && git pull && sudo docker-compose -f docker-compose.prod.yml up -d --build"

# View logs
ssh BAP "sudo docker logs basny-app --tail 50"

# Restart containers
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart"

# Database backup
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db '.backup /tmp/backup.db'"
```

## Configuration Management

### Development
- Config file: `src/config.json` (git-ignored)
- Contains database path, OAuth credentials, SMTP settings, R2 storage keys

### Production  
- Config file: `/mnt/basny-data/app/config/config.production.json`
- Mounted read-only into container at `/app/src/config.json`
- Database path must be absolute: `"/mnt/app-data/database/database.db"`

### Environment Variables
- `NODE_ENV`: Set to "production" in docker-compose.prod.yml
- `DATABASE_FILE`: Can override config file setting (optional)