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
Routes follow RESTful conventions and are domain-organized in `src/routes/`. All routes defined in `src/index.ts` with domain logic in separate route modules.

#### RESTful Patterns
We follow standard REST conventions for resource routes:
```
GET    /resource         - List all (index)
GET    /resource/new     - New resource form
POST   /resource         - Create resource
GET    /resource/:id     - View single resource
GET    /resource/:id/edit - Edit resource form
PATCH  /resource/:id     - Update resource
DELETE /resource/:id     - Delete resource
```

#### Main Route Groups

**Submissions** (`src/routes/submission.ts`)
```
GET    /submissions/new              - New submission form
GET    /submissions/new/addSupplement - Add supplement line (HTMX partial)
POST   /submissions                  - Create submission
GET    /submissions/:id              - View submission
PATCH  /submissions/:id              - Update submission
DELETE /submissions/:id              - Delete submission
```

**Tank Presets** (`src/routes/tank.ts`)
```
GET    /tank                 - View tank component (used in submission form)
GET    /tanks                - List saved tank presets
GET    /tanks/new            - New tank preset form (HTMX dialog)
POST   /tanks                - Create tank preset
PATCH  /tanks/:name          - Update tank preset (uses name, not ID)
DELETE /tanks/:name           - Delete tank preset
```

**Account Management** (`src/routes/account.ts`)
```
GET    /account              - View account settings
PATCH  /account              - Update account settings
DELETE /account/google        - Unlink Google account (gets sub from session)
```

**Authentication** (`src/routes/auth.ts`)
```
POST   /auth/signup          - Create account
POST   /auth/login           - Password login
GET    /auth/logout          - Logout
GET    /auth/forgot-password - Validate forgot password token
GET    /auth/set-password    - Validate set password token
POST   /auth/forgot-password - Send forgot password email
POST   /auth/reset-password  - Reset password with token
GET    /oauth/google         - Google OAuth callback (URL registered with Google)
```

**Auth Dialogs** (HTMX modals)
```
GET    /dialog/auth/signin          - Sign in dialog
GET    /dialog/auth/signup          - Sign up dialog
GET    /dialog/auth/forgot-password - Forgot password dialog
```

**Admin Routes** (`src/routes/adminRouter.ts`)
All admin routes are under `/admin/` prefix with admin auth middleware.

```
# Queues
GET    /admin/queue{/:program}          - Approval queue
GET    /admin/witness-queue{/:program}  - Witness confirmation queue
GET    /admin/waiting-period{/:program} - Waiting period queue

# Submission Management
POST   /admin/submissions/:id/approve          - Approve submission
GET    /admin/submissions/:id/edit             - Edit submission (admin view)
POST   /admin/submissions/:id/confirm-witness  - Confirm witness
POST   /admin/submissions/:id/decline-witness  - Decline witness
POST   /admin/submissions/:id/request-changes  - Request changes from submitter

# Admin Dialogs (HTMX)
GET    /admin/dialog/submissions/:id/decline-witness  - Decline witness form
GET    /admin/dialog/submissions/:id/request-changes  - Request changes form

# Member Management
GET    /admin/members                           - List members
GET    /admin/members/:memberId/edit            - Edit member form
PATCH  /admin/members/:memberId                 - Update member
POST   /admin/members/:memberId/check-levels    - Recalculate levels
POST   /admin/members/:memberId/check-specialty-awards - Check specialty awards
POST   /admin/members/:memberId/send-welcome    - Send welcome email
POST   /admin/members/invite                    - Invite new member
```

**Public Routes**
```
GET    /                     - Homepage with recent submissions
GET    /member/:memberId     - View member profile
GET    /me                   - Redirect to viewer's profile
GET    /standings{/:program} - Program standings
GET    /species              - Species explorer
GET    /species/:groupId     - Species group detail
```

**API Routes** (JSON responses)
```
GET    /api/members/search     - Typeahead search for members
GET    /api/species/search     - Typeahead search for species
```

#### Route Guidelines

**URL Parameter Naming**
- Use `:id` for numeric database IDs (standard REST)
- Use descriptive names for non-ID params (`:memberId`, `:program`, `:groupId`)
- Tank presets use `:name` as identifier (legacy, unique constraint on name)

**HTMX Integration**
- Partial templates return fragments, not full pages
- Use `hx-get`, `hx-post`, `hx-patch`, `hx-delete` with resource URLs
- Dialog routes under `/dialog/` namespace return modal HTML
- Admin dialogs under `/admin/dialog/` namespace

**Special Cases**
- OAuth callback URL (`/oauth/google`) cannot change - registered with Google
- Some routes support optional parameters with `{/:param}` syntax
- Submission validation accepts both `:id` and `:subId` for backward compatibility

**Route Module Organization**
- `src/routes/submission.ts` - Submission CRUD
- `src/routes/tank.ts` - Tank preset management
- `src/routes/account.ts` - User account settings
- `src/routes/auth.ts` - Authentication and OAuth
- `src/routes/member.ts` - Member profiles
- `src/routes/species.ts` - Species explorer
- `src/routes/standings.ts` - Program standings
- `src/routes/typeahead.ts` - Search APIs
- `src/routes/adminRouter.ts` - Admin-only routes (separate router with auth middleware)

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

### ⚠️ CRITICAL RESOURCES - DO NOT DELETE ⚠️

**IMPORTANT**: The following production resources contain live data and are protected:

- **EBS Volume**: `vol-0aba5b85a1582b2c0` (8GB)
  - Contains production database, config with secrets, SSL certificates
  - Protected with RETAIN deletion policy in CDK
  - Tagged with `DoNotDelete=true`
  - **NEVER detach or delete this volume**

- **Elastic IP**: `eipalloc-01f29c26363e0465a` (98.91.62.199)
  - DNS (bap.basny.org) points to this IP
  - Protected with RETAIN deletion policy in CDK
  - Tagged with `DoNotDelete=true`
  - **NEVER release or disassociate without updating DNS**

**Resource Reference Method**:
- Resource IDs stored in AWS Systems Manager Parameter Store
- CDK stack reads from SSM parameters at synth time (human-readable names)
- Parameters: `/basny/production/data-volume-id`, `/basny/production/elastic-ip-allocation-id`
- View parameters: `aws --profile basny ssm get-parameters --names /basny/production/data-volume-id /basny/production/elastic-ip-allocation-id /basny/production/elastic-ip-address`

**Data Loss Prevention**:
- Stack has termination protection enabled (prevents `cdk destroy`)
- UserData script checks for existing data before formatting volumes
- See `infrastructure/CRITICAL_RESOURCES.md` for recovery procedures and backup strategy

**Before ANY infrastructure changes**:
1. Create EBS snapshot: `aws --profile basny ec2 create-snapshot --volume-id vol-0aba5b85a1582b2c0`
2. Create database backup: `ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db '.backup /tmp/backup.db'"`
3. Test changes on separate stack, NEVER with production volume attached

### Infrastructure
- **Platform**: AWS EC2 (t3.micro) with 20GB EBS volume
- **IP**: 98.91.62.199 (Elastic IP - eipalloc-01f29c26363e0465a)
- **Data Volume**: vol-0aba5b85a1582b2c0 (8GB, persistent across all deployments)
- **SSH**: Connect via `ssh BAP` (configured in ~/.ssh/config)
- **Location**: `/opt/basny` (application code), `/mnt/basny-data` (persistent data)
- **CDK Stack**: Infrastructure defined in `infrastructure/` directory
  - Deploy: `cd infrastructure && npm run cdk deploy`
  - SSH key stored in AWS Systems Manager Parameter Store
  - ⚠️ **IMPORTANT**: EBS volume and Elastic IP are pinned in CDK code and will NEVER be replaced

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

**File Permissions (Security)**:
- `config.production.json`: Must be `-rw------- 1001:65533` (600, owned by nodejs user)
- `database.db`: Must be `-rw-r--r-- 1001:65533` (644, owned by nodejs user)
- App runs as UID 1001 (nodejs user), so files must be readable by this user

### Deployment Commands
```bash
# Deploy latest code
ssh BAP "cd /opt/basny && git pull && sudo docker-compose -f docker-compose.prod.yml up -d --build"

# Deploy with local changes (resets uncommitted changes on server)
ssh BAP "cd /opt/basny && git reset --hard && git pull && sudo docker-compose -f docker-compose.prod.yml up -d --build"

# View logs
ssh BAP "sudo docker logs basny-app --tail 50"

# Restart containers
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart"

# Restart specific container
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart nginx"

# Database backup
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db '.backup /tmp/backup.db'"

# Fix file permissions if needed
ssh BAP "sudo chown 1001:65533 /mnt/basny-data/app/config/config.production.json && sudo chmod 600 /mnt/basny-data/app/config/config.production.json"
ssh BAP "sudo chown 1001:65533 /mnt/basny-data/app/database/database.db && sudo chmod 644 /mnt/basny-data/app/database/database.db"
```

## Configuration Management

### Development
- Config file: `src/config.json` (git-ignored)
- Contains database path, OAuth credentials, SMTP settings, R2 storage keys

### Production
- Config file: `/mnt/basny-data/app/config/config.production.json`
- Mounted read-only into container at `/app/src/config.json`
- Database path must be absolute: `"/mnt/app-data/database/database.db"`
- **Permissions**: Must be 600 (owner-only) and owned by UID 1001 (nodejs user)

### Environment Variables
- `NODE_ENV`: Set to "production" in docker-compose.prod.yml
- `DATABASE_FILE`: Can override config file setting (optional)

## Security Notes

### Production Security Configuration
- **Server version hiding**: `server_tokens off` in nginx.conf hides version numbers
- **Express header**: `app.disable('x-powered-by')` hides Express version
- **Default server block**: nginx rejects requests with invalid Host headers (prevents host header injection)
- **File permissions**: Sensitive files (config, database) have restricted permissions
- **HTTPS**: All HTTP traffic redirects to HTTPS with HSTS enabled
- **Security headers**: X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy

### Nginx Configuration Notes
- Files in `nginx/conf.d/` are automatically included
- Remove any temporary/test config files (e.g., `ip-access.conf`) before production deployment
- Default server block must be first to properly reject invalid requests