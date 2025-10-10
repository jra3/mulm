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

### Code Quality Standards

**CRITICAL**: Follow these rules for maintainable, performant code:

- ❌ **Never use dynamic imports** - Always use static imports at the top of files
  ```typescript
  // WRONG
  const { someFunction } = await import('../module');

  // CORRECT
  import { someFunction } from '../module';
  ```
- ❌ **Never use `require()`** in TypeScript - Use ES6 imports
- ✅ **Static imports only** - Enables tree shaking, type checking, and better performance

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

## Color Palette & Design System

The app uses a structured color system with Tailwind CSS utility classes for consistency and semantic meaning.

### Core Color Meanings

**Background Colors**
- `bg-white` - Main content areas, cards, table backgrounds (pristine content)
- `bg-gray-100` - Page sections and content area backgrounds (subtle grouping)
- `bg-gray-200` - Dialogs, sidebars, dropdowns, modal backgrounds (elevated surfaces)
- `bg-gray-300` - Footer, form controls disabled state (muted elements)
- `bg-gray-50` - Table headers, hover states (subtle highlights)
- `bg-gray-700` - Admin notes section (dark/serious admin areas)
- `bg-gray-800` - Divider lines in forms (strong separators)

**Text Colors**
- `text-gray-800` - Primary body text (default for all pages)
- `text-gray-900` - Headings, emphasized text (stronger emphasis)
- `text-gray-700` - Secondary headings (medium emphasis)
- `text-gray-600` - Secondary/descriptive text (de-emphasized)
- `text-gray-500` - Muted text, placeholders, empty states (low priority)
- `text-gray-400` - Subtle hints, "Former Admin" labels (very subtle)

**Semantic Colors**

Status badges use a consistent pattern: `bg-{color}-100 text-{color}-800` for badges, `bg-{color}-50` for row backgrounds:

- **Blue** (`bg-blue-50/100`, `text-blue-600/700/800/900`) - Primary actions, pending approval, links, informational states
  - Buttons: `button.primary` uses `bg-blue-500 hover:bg-blue-700`
  - Status: "Pending Review" submissions
  - Links: Active navigation, clickable items
  - Info panels: Witness verification info, waiting period display

- **Red** (`bg-red-50/100/400/500`, `text-red-400/600/800`) - Errors, destructive actions, denied states
  - Buttons: `button.destructive` uses `bg-red-500 hover:bg-red-700`
  - Form errors: `class="error"` applies `border-red-500`
  - Error messages: `text-red-400` or `text-red-600`
  - Status: Denied submissions
  - Badge counts: Queue counts on buttons

- **Green** (`bg-green-50/100/600`, `text-green-600/800`) - Success, approved states, positive metrics
  - Status: Approved submissions
  - Activity: Submission approved icons
  - Metrics: Point displays, breed counts
  - Action buttons: Save buttons in admin

- **Yellow** (`bg-yellow-50/100`, `text-yellow-400/600/700/800`) - Warnings, draft state, awards
  - Status: Draft submissions
  - Warnings: Validation warnings in species explorer
  - Activity: Award granted icons
  - Alerts: "Witness needed" warnings

- **Orange** (`bg-orange-50/100`, `text-orange-800`) - Waiting period status
  - Status: Submissions in their waiting period

- **Purple** (`bg-purple-50/100`, `text-purple-800`) - Pending witness verification
  - Status: Needs witness verification

**Component-Specific Colors**
- Cards: `bg-white rounded-lg shadow-md` (white on gray-100 backgrounds)
- Tables: `bg-white` with `bg-gray-50` headers and `hover:bg-gray-50` rows
- Borders: `border-gray-200/300` for subtle dividers
- Shadows: `shadow-sm/md/lg` for depth hierarchy
- Links: `text-gray-500 hover:text-black` (default), `text-blue-600 hover:text-blue-800` (in content)

### Predefined CSS Classes

Use these component classes from `src/index.css` instead of long Tailwind chains:

```css
.link                    /* Links: gray-500 with hover:underline hover:text-black */
.link.light              /* Light links: white with hover:text-gray-200 */

button.primary           /* Blue primary action buttons */
button.destructive       /* Red destructive action buttons */
button.outline           /* Gray outline buttons */

.card                    /* White card with shadow and padding */
.text-input              /* Standard text input styling */
.text-input.error        /* Input with red border for errors */
.input-label             /* Form label styling */

.status-panel            /* Base panel for submission status */
.status-panel-pending    /* Blue panel for pending states */
.status-panel-warning    /* Yellow panel for warnings */
.status-panel-admin      /* Dark gray panel for admin sections */
```

### Status Badge Pattern

All submission statuses follow this consistent pattern:
```typescript
{
  status: 'approved',
  label: 'Approved',
  color: 'text-green-800',      // Dark text
  bgColor: 'bg-green-100',       // Light background
  rowColor: 'bg-green-50',       // Very light row highlight
  description: 'Details...'
}
```

**Status Color Map**:
- Draft: `bg-yellow-100 text-yellow-800` with 📝 icon
- Pending Witness: `bg-purple-100 text-purple-800` with 👁️ icon
- Waiting Period: `bg-orange-100 text-orange-800` with ⏳ icon
- Pending Review: `bg-blue-100 text-blue-800` with 🔵 icon
- Approved: `bg-green-100 text-green-800` with ✅ icon
- Denied: `bg-red-100 text-red-800` with ❌ icon

### Choosing Colors

When adding new features:
1. **Interactive elements** - Use blue (`bg-blue-500/600/700` or `button.primary`)
2. **Success/completion** - Use green (`bg-green-100 text-green-800`)
3. **Warnings/caution** - Use yellow (`bg-yellow-50 border-yellow-400`)
4. **Errors/deletion** - Use red (`bg-red-500` or `button.destructive`)
5. **Neutral info** - Use gray scale (`bg-gray-100`, `text-gray-600`)

**Avoid**: Using colors outside this palette. Don't introduce new semantic colors (teal, pink, indigo) unless they serve a distinct, necessary purpose.

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
- ✅ Use predefined component classes when available: `button.primary` instead of full Tailwind button classes

## Date Formatting

**IMPORTANT**: All date formatting must use centralized utilities and mixins for consistency and accessibility.

### Utilities (`src/utils/dateFormat.ts`)
Never use `.toLocaleDateString()` or `.toDateString()` directly. Always use these utilities:

```typescript
import { formatShortDate, formatLongDate, formatRelativeDate, formatISODate, isValidDate } from '@/utils/dateFormat';

// Compact format for tables
formatShortDate('2025-01-15') // "01/15/2025"

// Long format for detailed views
formatLongDate('2025-01-15') // "January 15, 2025"

// Relative format for activity feeds
formatRelativeDate('2025-10-04') // "3 days ago"

// ISO format for datetime attributes
formatISODate('2025-01-15') // "2025-01-15T00:00:00.000Z"

// Validate before formatting
if (isValidDate(dateString)) {
  // format it
}
```

### Pug Mixins (`src/views/mixins/date.pug`)
Use these mixins in templates for semantic HTML with accessibility:

```pug
include mixins/date.pug

//- Short format (MM/DD/YYYY) - for tables
+shortDate(submission.submitted_on)

//- Long format (Month DD, YYYY) - for detailed views
+longDate(submission.approved_on, "Approved on")

//- Relative format (X days ago) - for activity feeds
+relativeDate(activity.created_at)

//- Flexible format
+dateTime(date, 'short')  // or 'long', 'relative'
```

### When to Use Each Format

- **shortDate** - Tables, lists, compact displays (MM/DD/YYYY)
- **longDate** - Emails, formal contexts, detailed views ("January 15, 2025")
- **relativeDate** - Activity feeds, recent events ("3 days ago")
- **Server-side formatting** - Only for form fields/disabled inputs (use `formatShortDate()`)

### Key Rules
- ✅ **Always use mixins in templates** - They generate proper `<time>` elements
- ✅ **Use local timezone** - Dates display in user's local timezone to match calendar dates
- ✅ **Handle null/undefined** - All utilities return empty string for invalid dates
- ✅ **Provide aria-labels** - Second parameter adds context for screen readers
- ❌ **Never use** `.toLocaleDateString()` or `.toDateString()` directly
- ❌ **Never format dates** in route handlers unless needed for form fields

### Database Storage
- Always store dates as ISO strings using `new Date().toISOString()`
- Display formatting happens at the presentation layer only (templates)
- Never store formatted dates in the database

## Logging
- Custom logger in `src/utils/logger.ts` respects NODE_ENV
- Automatically silenced during tests (NODE_ENV=test)
- Use `logger.error()`, `logger.warn()`, `logger.info()` instead of console.*

## Production Deployment

**📖 Full Documentation**: See [GitHub Wiki](https://github.com/jra3/mulm/wiki) for comprehensive guides:
- [Production Deployment](https://github.com/jra3/mulm/wiki/Production-Deployment) - Deployment procedures, troubleshooting, rollback
- [Infrastructure Guide](https://github.com/jra3/mulm/wiki/Infrastructure-Guide) - AWS resources, CDK deployment, recovery procedures
- [Security Overview](https://github.com/jra3/mulm/wiki/Security-Overview) - Security posture and tracking

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
- Five layers of protection: Visual identification, CDK deletion policies, stack termination protection, UserData safety checks, documentation

**⚠️ Data Loss History**:
On October 6, 2025, the production EBS volume was accidentally formatted due to a race condition in the UserData script. This resulted in complete loss of production database, SSL certificates, and production config. **Lesson**: Always test infrastructure changes with detached volumes first.

**Before ANY infrastructure changes**:
1. Create EBS snapshot: `aws --profile basny ec2 create-snapshot --volume-id vol-0aba5b85a1582b2c0 --description "Pre-deployment backup $(date +%Y%m%d-%H%M%S)" --tag-specifications 'ResourceType=snapshot,Tags=[{Key=Name,Value=BASNY-PreDeployment-Backup},{Key=DoNotDelete,Value=true}]'`
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

#### Standard Deployment
```bash
# Deploy latest code from main branch
ssh BAP "cd /opt/basny && git pull && sudo docker-compose -f docker-compose.prod.yml up -d --build"

# Deploy with local changes (resets uncommitted changes on server)
ssh BAP "cd /opt/basny && git reset --hard && git pull && sudo docker-compose -f docker-compose.prod.yml up -d --build"

# Verify deployment
ssh BAP "sudo docker ps"  # Check container status
ssh BAP "sudo docker logs basny-app --tail 50"  # View app logs
curl https://bap.basny.org/health  # Test health endpoint
```

#### Common Operations
```bash
# View logs
ssh BAP "sudo docker logs basny-app --tail 100 -f"  # Application logs
ssh BAP "sudo docker logs basny-nginx --tail 100 -f"  # Nginx logs
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml logs --tail 100 -f"  # All logs

# Restart services
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart"  # All services
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart app"  # App only
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart nginx"  # Nginx only

# Database operations
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db '.backup /tmp/backup_$(date +%Y%m%d_%H%M%S).db'"  # Backup
scp BAP:/tmp/backup_*.db ./backups/  # Download backup
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db 'SELECT COUNT(*) FROM members;'"  # Query
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db 'PRAGMA integrity_check;'"  # Check integrity

# Update configuration
ssh BAP "sudo nano /mnt/basny-data/app/config/config.production.json"  # Edit config
ssh BAP "ls -la /mnt/basny-data/app/config/config.production.json"  # Check permissions (should be -rw------- 1001:65533)
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart app"  # Restart after config change

# Fix file permissions if needed
ssh BAP "sudo chown 1001:65533 /mnt/basny-data/app/config/config.production.json && sudo chmod 600 /mnt/basny-data/app/config/config.production.json"
ssh BAP "sudo chown 1001:65533 /mnt/basny-data/app/database/database.db && sudo chmod 644 /mnt/basny-data/app/database/database.db"
```

#### Monitoring & Health Checks
```bash
# Application health
curl https://bap.basny.org/health  # Should return: {"status":"healthy","timestamp":"..."}

# Container health
ssh BAP "sudo docker ps --format 'table {{.Names}}\t{{.Status}}'"

# Resource usage
ssh BAP "df -h /mnt/basny-data"  # Disk usage
ssh BAP "free -h"  # Memory usage
ssh BAP "top -bn1 | head -20"  # CPU usage
```

#### Troubleshooting
```bash
# Container issues
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml logs"  # View all logs
ssh BAP "sudo docker ps -a"  # Check all containers including stopped
ssh BAP "sudo docker restart basny-app"  # Restart stuck container
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml down && sudo docker-compose -f docker-compose.prod.yml up -d --build"  # Rebuild from scratch

# Build issues
ssh BAP "sudo docker builder prune -a"  # Clean build cache
ssh BAP "sudo docker system df"  # Check disk usage
ssh BAP "sudo docker image prune -a"  # Remove old images

# Database issues
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db 'PRAGMA integrity_check;'"  # Check integrity
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db 'VACUUM;'"  # Compact database
ssh BAP "ls -lh /mnt/basny-data/app/database/database.db"  # Check size

# Disk space issues
ssh BAP "du -h --max-depth=1 /mnt/basny-data/ | sort -hr"  # Find large directories
ssh BAP "sudo docker system prune -a --volumes"  # Clean Docker resources (⚠️ removes unused containers/images/networks)
ssh BAP "find /mnt/basny-data/nginx/logs -type f -size +100M -ls"  # Find large log files
```

#### Rollback Procedure
```bash
# 1. View recent commits
ssh BAP "cd /opt/basny && git log --oneline -10"

# 2. Revert to specific commit
ssh BAP "cd /opt/basny && git reset --hard <commit-hash>"
# Or revert to previous commit: ssh BAP "cd /opt/basny && git reset --hard HEAD~1"

# 3. Rebuild previous version
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml up -d --build"

# 4. Restore database if needed (list backups first)
ssh BAP "ls -lh /tmp/backup_*.db"
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db '.restore /tmp/backup_YYYYMMDD_HHMMSS.db'"
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart app"

# 5. Verify rollback
curl https://bap.basny.org/health
ssh BAP "cd /opt/basny && git log --oneline -1"  # Check current commit
```

### Database Backup System

**📖 Full Documentation**: See [Backup & Recovery Guide](https://github.com/jra3/mulm/wiki/Backup-Recovery) for comprehensive backup and recovery procedures.

**Quick Reference**:
- **Scripts**: `scripts/backup-database.sh`, `scripts/restore-database.sh`, `scripts/backup-status.sh`
- **Backup Location**: `/mnt/basny-data/backups/` (on EBS volume)
- **Retention**: Hourly (4), Daily (7), Weekly (4), Monthly (12)
- **Cron Schedule**: Setup documented in wiki

**Common Commands**:
```bash
# Manual backup
ssh BAP "/opt/basny/scripts/backup-database.sh hourly"

# Check backup status
ssh BAP "/opt/basny/scripts/backup-status.sh"

# Restore from backup (interactive)
ssh BAP "/opt/basny/scripts/restore-database.sh"

# View backup logs
ssh BAP "tail -f /mnt/basny-data/backups/backup.log"
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

### Nginx Configuration

**Configuration Files**:
- `nginx/nginx.conf` - Main nginx config with rate limiting zones
- `nginx/conf.d/default.conf` - Server blocks for HTTP/HTTPS
- Files in `nginx/conf.d/` are automatically included
- Remove any temporary/test config files before production deployment

**SSL/HTTPS Setup**:
- Let's Encrypt certificate for bap.basny.org
- Auto-renewal via certbot container (runs every 12 hours)
- Certificate stored in `/mnt/basny-data/nginx/certs/`
- HTTP traffic redirects to HTTPS (301)
- HSTS enabled with preload: `max-age=31536000; includeSubDomains; preload`
- Modern TLS: TLSv1.2 and TLSv1.3 only

**Rate Limiting** (defined in nginx.conf):
- **General requests**: 10 req/sec (burst 20)
  - Applied to all requests by default
- **API endpoints** (`/api/*`): 30 req/sec (burst 50)
  - Higher limit for API calls
- **Upload endpoints** (`/submission`, `/tank`, `/upload`): 5 req/sec (burst 10)
  - Lower limit to prevent abuse
  - 100MB max upload size
  - 300s timeout for large uploads

**Security Headers**:
- `Strict-Transport-Security`: Force HTTPS for 1 year
- `X-Frame-Options: SAMEORIGIN`: Prevent clickjacking
- `X-Content-Type-Options: nosniff`: Prevent MIME sniffing
- `X-XSS-Protection: 1; mode=block`: Enable XSS filter
- `Referrer-Policy: strict-origin-when-cross-origin`: Control referrer info

**Default Server Block**:
- First server block catches invalid Host headers
- Returns 444 (close connection without response)
- Prevents host header injection attacks

**Updating Nginx Config**:
```bash
# Edit local config
vim nginx/conf.d/default.conf

# Copy to production and test
scp nginx/conf.d/default.conf BAP:/tmp/
ssh BAP "sudo cp /tmp/default.conf /opt/basny/nginx/conf.d/ && sudo docker exec basny-nginx nginx -t"

# Reload nginx
ssh BAP "sudo docker exec basny-nginx nginx -s reload"
```

**SSL Certificate Renewal**:
```bash
# Check certificate status
ssh BAP "sudo docker exec basny-certbot certbot certificates"

# Manual renewal (if needed)
ssh BAP "sudo docker exec basny-certbot certbot renew"

# Test renewal process
ssh BAP "sudo docker exec basny-certbot certbot renew --dry-run"
```

## Recovery Procedures

### If Database is Lost

1. **Locate most recent backup**:
```bash
ssh BAP
ls -lah /tmp/*.sqlite /tmp/*.db  # Check local backups
ls -lah ~/backups/*.sqlite ~/backups/*.db  # Check manual backups
```

2. **Restore database**:
```bash
# Stop application
cd /opt/basny
sudo docker-compose -f docker-compose.prod.yml down

# Copy backup to data volume
sudo cp /path/to/backup.sqlite /mnt/basny-data/app/database/database.db

# Fix permissions (CRITICAL - must be owned by nodejs user UID 1001)
sudo chown 1001:65533 /mnt/basny-data/app/database/database.db
sudo chmod 644 /mnt/basny-data/app/database/database.db

# Restart application
sudo docker-compose -f docker-compose.prod.yml up -d
```

3. **Verify data integrity**:
```bash
sqlite3 /mnt/basny-data/app/database/database.db "PRAGMA integrity_check;"
```

### If Config is Lost

1. **Restore config**:
```bash
# Copy config to data volume (from backup or password manager)
sudo cp /tmp/config.production.json /mnt/basny-data/app/config/config.production.json

# Fix permissions (CRITICAL - must be 600 owner-only)
sudo chown 1001:65533 /mnt/basny-data/app/config/config.production.json
sudo chmod 600 /mnt/basny-data/app/config/config.production.json

# Restart application
cd /opt/basny
sudo docker-compose -f docker-compose.prod.yml restart
```

### If SSL Certificates are Lost

1. **Verify DNS is pointing to current IP**:
```bash
dig bap.basny.org +short  # Should return: 98.91.62.199
```

2. **Re-issue SSL certificates** (after DNS propagates):
```bash
cd /opt/basny
sudo ./scripts/init-letsencrypt.sh
```

### If Entire Volume is Lost

**Prevention** (ALWAYS do before infrastructure changes):
```bash
aws --profile basny ec2 create-snapshot \
  --volume-id vol-0aba5b85a1582b2c0 \
  --description "Pre-deployment backup $(date +%Y%m%d-%H%M%S)" \
  --tag-specifications 'ResourceType=snapshot,Tags=[{Key=Name,Value=BASNY-PreDeployment-Backup},{Key=DoNotDelete,Value=true}]'
```

**Recovery** (if snapshot exists):
1. Create new volume from snapshot:
```bash
aws --profile basny ec2 create-volume \
  --snapshot-id snap-XXXXXXXXX \
  --availability-zone us-east-1a \
  --volume-type gp3 \
  --tag-specifications 'ResourceType=volume,Tags=[{Key=Name,Value=BASNY-Data-Restored},{Key=DoNotDelete,Value=true}]'
```

2. Update SSM parameter:
```bash
aws --profile basny ssm put-parameter \
  --name /basny/production/data-volume-id \
  --value vol-NEW_VOLUME_ID \
  --overwrite
```

3. Redeploy CDK stack:
```bash
cd infrastructure
npm run cdk deploy -- --profile basny
```

4. Verify data integrity:
```bash
ssh BAP
ls -la /mnt/basny-data/app/
sqlite3 /mnt/basny-data/app/database/database.db "PRAGMA integrity_check;"
```

## Infrastructure Deployment

### Initial CDK Deployment

**Prerequisites**:
- AWS CLI configured with basny profile: `aws configure --profile basny`
- AWS CDK CLI installed: `npm install -g aws-cdk`
- Infrastructure dependencies: `cd infrastructure && npm install`

**First-time deployment**:
```bash
# 1. Bootstrap CDK (creates toolkit stack: S3, ECR, IAM)
cd infrastructure
npm run cdk bootstrap -- --profile basny

# 2. Build and deploy
npm run build
npm run cdk deploy -- --profile basny
```

**Outputs after deployment**:
- InstanceId: EC2 instance identifier
- PublicIP: Elastic IP address (98.91.62.199)
- SSHCommand: Command to SSH into instance
- KeyPairId: ID of the SSH key pair

**Retrieve SSH key**:
```bash
cd infrastructure
./scripts/get-private-key.sh  # Saves to ~/.ssh/basny-ec2-keypair.pem with 400 permissions
```

### CDK Redeployment

When updating infrastructure (instance type, security groups, etc.):

```bash
# 1. Create snapshot FIRST (CRITICAL)
aws --profile basny ec2 create-snapshot \
  --volume-id vol-0aba5b85a1582b2c0 \
  --description "Pre-deployment backup $(date +%Y%m%d-%H%M%S)"

# 2. Build CDK stack
cd infrastructure
npm run build

# 3. Preview changes
npm run cdk diff -- --profile basny
# Review: EC2 instance may be REPLACED, but EBS volume and Elastic IP will remain UNCHANGED

# 4. Deploy
npm run cdk deploy -- --profile basny

# 5. Verify
aws --profile basny ec2 describe-instances --filters "Name=tag:Name,Values=BASNY-Production"
ssh BAP "sudo docker ps"
```

**What persists across redeployments**:
- ✅ EBS Data Volume (vol-0aba5b85a1582b2c0) - references existing volume
- ✅ Elastic IP (98.91.62.199) - associates with new instance
- ✅ All data in /mnt/basny-data/

**What gets replaced**:
- EC2 instance (if configuration changed)
- Root volume (contains no persistent data)

### Testing Infrastructure Changes Safely

**NEVER test with production volume attached!**

1. **Create test volume**:
```bash
aws --profile basny ec2 create-volume \
  --availability-zone us-east-1a \
  --size 8 \
  --volume-type gp3 \
  --tag-specifications 'ResourceType=volume,Tags=[{Key=Name,Value=BASNY-Test}]'
```

2. **Update SSM parameter for test**:
```bash
aws --profile basny ssm put-parameter \
  --name /basny/test/data-volume-id \
  --value vol-TEST_VOLUME_ID \
  --overwrite
```

3. **Deploy to separate stack**:
```bash
# Modify stack name in bin/infrastructure.ts to test name
cd infrastructure
npm run cdk deploy -- --profile basny
```

4. **Delete test resources after verification**:
```bash
npm run cdk destroy -- --profile basny
aws --profile basny ec2 delete-volume --volume-id vol-TEST_VOLUME_ID
```

### Backup Strategy

**Recommended schedule**:
- Daily: Automated database backups to S3 (not yet implemented)
- Weekly: Full EBS volume snapshots
- Pre-deployment: Manual snapshot before infrastructure changes

**Manual backup**:
```bash
# Database backup
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db '.backup /tmp/backup-$(date +%Y%m%d-%H%M%S).db'"
scp BAP:/tmp/backup-*.db ~/backups/

# EBS snapshot
aws --profile basny ec2 create-snapshot \
  --volume-id vol-0aba5b85a1582b2c0 \
  --description "Manual backup $(date +%Y%m%d-%H%M%S)" \
  --tag-specifications 'ResourceType=snapshot,Tags=[{Key=Name,Value=BASNY-Manual-Backup},{Key=DoNotDelete,Value=true}]'

# List snapshots
aws --profile basny ec2 describe-snapshots \
  --owner-ids self \
  --filters "Name=tag:Name,Values=BASNY-*" \
  --query 'Snapshots[*].[SnapshotId,StartTime,Description]' \
  --output table
```

### Pre-Deployment Checklist

Before ANY `cdk deploy` or infrastructure changes:
- [ ] Create snapshot of production EBS volume
- [ ] Verify production volume is NOT attached to test instance
- [ ] Review UserData script for safety checks
- [ ] Verify RETAIN deletion policies are set
- [ ] Confirm stack termination protection is enabled
- [ ] Have recent database backup available locally
- [ ] Test changes on separate stack first
- [ ] Review `cdk diff` output carefully